var _ = require('lodash'),
    async = require('async');

var config = require('../config');

var services = require('./services'),
    repository = services.repository,
    reviewboard = services.reviewboard,
    bugzilla = services.bugzilla;

function getBug(bugId, callback) {
  var options = {
    includeFields: 'summary'
  };
  return bugzilla.getBug(bugId, options, callback);
}
exports.getBug = getBug;

function findChangesets(rev, callback) {
  var revset = rev + ':';
  return getChangesetsByRevset(revset, function(err, changesets) {
    if (err) return callback(err);

    return findReviewRequests(changesets, function(err, reviewRequests) {
      if (err) return callback(err);

      if (changesets.length !== reviewRequests.length) {
        var msg = "ERROR: changesets.length does not equal reviewRequests.length, " +
          "so they can not be combined.\n" +
          "changesets.length: " + changesets.length + "\n" +
          "reviewRequests.length: " + reviewRequests.length + "\n";
        return callback(new Error(msg));
      }

      for (var i = 0; i < changesets.length; i++) {
        changesets[i].reviewRequest = extractBasicInfo(reviewRequests[i]);
      }

      return callback(null, changesets);
    });
  });
}
exports.findChangesets = findChangesets;

function getExistingParentReviewRequest(bugId, callback) {
  return findParentReviewRequest(bugId, function(err, parentReviewRequest) {
    if (err) return callback(err);
    if (!parentReviewRequest) {
      // there's no parent review requests yet
      return callback(null, null);
    }

    var childReviewRequestIds = parentReviewRequest.depends_on.map(extractIdFromUrl);
    return getReviewRequests(childReviewRequestIds,
      function(err, childReviewRequests) {
        if (err) return callback(err);

        // lookup table to get child review request by commit ID
        var lookup = _(childReviewRequests)
          .filter('commit_id')
          .indexBy('commit_id')
          .value();

        var changesetIds = Object.keys(lookup);
        return getChangesetsByRevsets(changesetIds, function(err, changesets) {
          if (err) return callback(err);

          changesets.forEach(function(changeset) {
            var reviewRequest = lookup[changeset.node];
            if (reviewRequest) {
              changeset.reviewRequest = extractBasicInfo(reviewRequest);
            }
          });

          // FIXME: not sure simply ordering by 'rev' is the right way to do it
          changesets = _.sortBy(changesets, 'rev');

          var result = extractBasicInfo(parentReviewRequest);
          result.changesets = changesets;

          return callback(null, result);
        });
      }
    );
  });
}
exports.getExistingParentReviewRequest = getExistingParentReviewRequest;

function findReviewers(query, callback) {
  var options = {
    'max-results': 15,
    'fullname': true
  };

  if (query) {
    options.q = query;
  }

  return reviewboard.findUsers(options, function(err, users) {
    if (err) return callback(err);
    var reviewers = users.map(function(user) {
      return _.pick(user, 'id', 'username', 'fullname', 'email');
    });
    return callback(null, reviewers);
  });
}
exports.findReviewers = findReviewers;

function doDiscardReviewRequest(id, callback) {
  return reviewboard.getReviewRequest(id, function(err, reviewRequest) {
    if (err) return callback(err);

    var parentIds = reviewRequest.blocks.map(extractIdFromUrl);
    return removeChildFromParentReviewRequests(
      reviewRequest.id,
      parentIds,
      function(err) {
        if (err) return callback(err);

        return discardReviewRequest(reviewRequest.id, callback);
      }
    );
  });

  return discardReviewRequest(id, function(err, reviewRequest) {
    if (err) return callback(err);

    var parentIds = reviewRequest.blocks.map(extractIdFromUrl);
    return removeChildFromParentReviewRequests(reviewRequest.id, parentIds, callback);
  });
}
exports.doDiscardReviewRequest = doDiscardReviewRequest;

function discardReviewRequest(id, callback) {
  var options = {
    status: 'discarded'
  };
  return reviewboard.updateReviewRequest(id, options, function(err) {
    if (err) return callback(err);

    // disassociate changeset from review request
    var options = {
      commitId: null
    };
    return reviewboard.createReviewRequestDraft(id, options, function(err) {
      if (err) return callback(err);

      // read back the review request
      return reviewboard.getReviewRequest(id, callback);
    });
  });
}
exports.discardReviewRequest = discardReviewRequest;

function reopenReviewRequest(id, callback) {
  var options = {
    status: 'pending'
  };
  return reviewboard.updateReviewRequest(id, options, function(err) {
    if (err) return callback(err);

    // we have to post a new review request draft
    // to mark reopened review request as public
    return reviewboard.createReviewRequestDraft(id, {}, function(err) {
      if (err) return callback(err);

      // read back the review request
      return reviewboard.getReviewRequest(id, callback);
    });
  });
}
exports.reopenReviewRequest = reopenReviewRequest;

function removeChildFromParentReviewRequests(childId, parentIds, callback) {
  var f = removeChildFromParentReviewRequest.bind(null, childId);
  return async.eachLimit(parentIds, config.ASYNC_LIMIT, f, callback);
}
exports.removeChildFromParentReviewRequests = removeChildFromParentReviewRequests;

function removeChildFromParentReviewRequest(childId, parentId, callback) {
  return reviewboard.getReviewRequest(parentId, function(err, parent) {
    if (err) return callback(err);
    if (!parent) {
      console.error('WARNING: can not remove child from parent review request - ' +
        'parent review request not found: ' + parentId);
      return callback();
    }

    if (!parent.depends_on) {
      // no depends_on field - nothing to remove from
      return callback();
    }

    var childrenIds = parent.depends_on.map(extractIdFromUrl);
    childrenIds = _.without(childrenIds, childId);
    return getReviewRequests(childrenIds, function(err, reviewRequests) {
      if (err) return callback(err);

      reviewRequests = _.indexBy(reviewRequests, 'id');

      var context = extractContextFromReviewRequest(parent);
      return createParentReviewRequestDraft(context, parent.id, reviewRequests, callback);
    });
  });
}
exports.removeChildFromParentReviewRequest = removeChildFromParentReviewRequest;

function extractContextFromReviewRequest(rr) {
  var context = {};
  if (rr.bugs_closed && rr.bugs_closed[0]) {
    context.bug = rr.bugs_closed[0];
  }
  if (rr.target_people && rr.target_people[0]) {
    context.reviewer = rr.target_people[0].title;
  }
  return context;
}
exports.extractContextFromReviewRequest = extractContextFromReviewRequest;

function doCreateReviewRequest(context, revs, callback) {
  // get changesets
  return getChangesetsByRevsets(revs, function(err, changesets) {
    if (err) return callback(err);

    // find or create individual review requests for every changeset
    return findOrCreateReviewRequests(context, changesets, function(err, newReviewRequests) {
      if (err) return callback(err);

      newReviewRequests = _.indexBy(newReviewRequests, 'id');

      // find or create a parent review request
      return findOrCreateParentReviewRequest(context.bug, function(err, parentReviewRequest) {
        if (err) return callback(err);

        // get previously created review requests that are associated with our parent
        var existingReviewRequestIds = parentReviewRequest.depends_on.map(extractIdFromUrl);
        return getReviewRequests(existingReviewRequestIds,
          function(err, existingReviewRequests) {
            if (err) return callback(err);

            existingReviewRequests = _.indexBy(existingReviewRequests, 'id');

            // merge existing and new review requests
            var reviewRequests = {};
            _.assign(reviewRequests, existingReviewRequests, newReviewRequests);

            // generate and upload squashed diff
            return createParentReviewRequestDiff(parentReviewRequest.id,
              reviewRequests,
              function(err) {
                // update parent review request to list both existing and new
                // review requests as dependencies
                return createParentReviewRequestDraft(context,
                  parentReviewRequest.id,
                  reviewRequests,
                  function(err) {
                    if (err) return callback(err);

                    var parent = extractBasicInfo(parentReviewRequest);
                    var children = _.map(reviewRequests, extractBasicInfo);
                    var result = {
                      parent: parent,
                      children: children
                    };
                    return callback(null, result);
                  }
                );
              }
            );
          }
        );
      });
    });
  });
}
exports.doCreateReviewRequest = doCreateReviewRequest;

function createParentReviewRequestDiff(id, reviewRequests, callback) {
  var changesetIds = _.pluck(reviewRequests, 'commit_id');
  return getChangesetsByRevsets(changesetIds, function(err, changesets) {
    if (err) return callback(err);

    // FIXME: not sure simply ordering by 'rev' is the right way to do it
    changesets = _.sortBy(changesets, 'rev');
    firstChangeset = _.first(changesets);
    lastChangeset = _.last(changesets);

    return getParentChangeset(firstChangeset.node, function(err, parentChangeset) {
      if (err) return callback(err);
      if (!parentChangeset) {
        var msg = 'could not find parent changeset of ' + firstChangeset.node;
        return callback(new Error(msg));
      }

      var options = {
        rev: parentChangeset.node + '::' + lastChangeset.node
      };
      return repository.diff(options, function(err, diff) {
        if (err) return callback(err);

        var options = {
          path: diff,
          baseCommitId: parentChangeset.node
        };

        return reviewboard.uploadDiff(id, options, callback);
      });
    });
  });
}
exports.createParentReviewRequestDiff = createParentReviewRequestDiff;

function createParentReviewRequestDraft(context, id, reviewRequests, callback) {
  // TODO: use summary from Bugzilla
  var summary = 'Bug ' + context.bug;
  var description = _.map(reviewRequests, function(reviewRequest) {
    return '/r/' + reviewRequest.id + ' - ' + reviewRequest.summary;
  }).join("\n");

  var options = {
    summary: summary,
    description: description,
    targetPeople: context.reviewer,
    bugsClosed: context.bug,
    dependsOn: _.map(reviewRequests, 'id')
  };
  return reviewboard.createReviewRequestDraft(id, options, callback);
}
exports.createParentReviewRequestDraft = createParentReviewRequestDraft;

function findOrCreateParentReviewRequest(bug, callback) {
  return findParentReviewRequest(bug, function(err, parentReviewRequest) {
    if (err) return callback(err);
    if (parentReviewRequest) return callback(null, parentReviewRequest);

    var options = {
      commitId: 'bug-' + bug
    };
    return reviewboard.createReviewRequest(options, callback);
  });
}
exports.findOrCreateParentReviewRequest = findOrCreateParentReviewRequest;

function findParentReviewRequest(bug, callback) {
  // FIXME: RB API won't allow us to search for existing review requests
  // by bug number, so we have to abuse commit_id field instead
  var options = {
    commitId: 'bug-' + bug
  };
  return reviewboard.findReviewRequest(options, callback);
}
exports.findParentReviewRequest = findParentReviewRequest;

function getReviewRequests(ids, callback) {
  var getReviewRequest = reviewboard.getReviewRequest.bind(reviewboard);
  return async.mapLimit(ids, config.ASYNC_LIMIT, getReviewRequest, callback);
}
exports.getReviewRequests = getReviewRequests;

function findOrCreateReviewRequests(context, changesets, callback) {
  var f = findOrCreateReviewRequest.bind(null, context);
  return async.mapLimit(changesets, config.ASYNC_LIMIT, f, callback);
}
exports.findOrCreateReviewRequests = findOrCreateReviewRequests;

function findOrCreateReviewRequest(context, changeset, callback) {
  return findReviewRequest(changeset, function(err, reviewRequest) {
    if (err) return callback(err);
    if (reviewRequest) {
      if (reviewRequest.status == 'discarded') {
        return reopenReviewRequest(reviewRequest.id, callback);
      } else {
        return callback(null, reviewRequest);
      }
    } else {
      return createReviewRequest(context, changeset, callback);
    }
  });
}
exports.findOrCreateReviewRequest = findOrCreateReviewRequest;

function findReviewRequests(changesets, callback) {
  return async.mapLimit(changesets, config.ASYNC_LIMIT, findReviewRequest, callback);
}
exports.findReviewRequests = findReviewRequests;

function findReviewRequest(changeset, callback) {
  var options = {
    commitId: changeset.node
  };
  return reviewboard.findReviewRequest(options, callback);
}
exports.findReviewRequest = findReviewRequest;

function createReviewRequest(context, changeset, callback) {
  var options = {
    commitId: changeset.node
  };
  return reviewboard.createReviewRequest(options, function(err, reviewRequest) {
    if (err) return callback(err);

    return createReviewRequestDraft(reviewRequest.id,
      context,
      changeset,
      callback);
  });
}
exports.createReviewRequest = createReviewRequest;

function createReviewRequestDraft(id, context, changeset, callback) {
  // get the changeset diff
  var options = {
    rev: changeset.node
  };
  return repository.export(options, function(err, diff) {
    if (err) return callback(err);

    // attach changeset diff to review request
    var options = {
      path: diff
    };
    return reviewboard.uploadDiff(id, options, function(err) {
      if (err) return callback(err);

      // set review request details by creating review request draft
      var options = {
        commitId: changeset.node,
        summary: changeset.summary,
        description: changeset.spillover
      };

      if (context.reviewer) {
        options.targetPeople = context.reviewer;
      }

      if (context.bug) {
        options.bugsClosed = context.bug;
      }

      return reviewboard.createReviewRequestDraft(id, options,
        function(err) {
          if (err) return callback(err);

          // read back review request details
          return reviewboard.getReviewRequest(id, callback);
        }
      );
    });
  });
}
exports.createReviewRequestDraft = createReviewRequestDraft;

function rewriteReviewRequest(id, rev, callback) {
  return getChangesetsByRevset(rev, function(err, changesets) {
    if (err) return callback(err);

    return reviewboard.getReviewRequest(id, function(err, reviewRequest) {
      if (err) return callback(err);

      var context = extractContextFromReviewRequest(reviewRequest);
      var changeset = changesets[0];
      return createReviewRequestDraft(id, context, changeset, callback);
    });
  });
}
exports.rewriteReviewRequest = rewriteReviewRequest;

function getParentChangeset(rev, callback) {
  var revset = rev + '^';
  return getChangesetsByRevset(revset, function(err, changesets) {
    if (err) return callback(err);
    if (!changesets) return callback(null, null);
    return callback(null, changesets[0]);
  });
}
exports.getParentChangeset = getParentChangeset;

function getChangesetsByRevsets(revs, callback) {
  return async.map(revs, getChangesetsByRevset, function(err, changesets) {
    if (err) return callback(err);
    changesets = _.flatten(changesets, true);
    return callback(null, changesets);
  });
}
exports.getChangesetsByRevsets = getChangesetsByRevsets;

function getChangesetsByRevset(revset, callback) {
  var fields = {
    id: 'node|short',
    node: 'node',
    rev: 'rev',
    author: 'author',
    user: 'author|user',
    date: 'date|isodatesec',
    description: 'desc|urlescape'
  };

  var template = '';
  for (var k in fields) {
    template += k + ':{' + fields[k] + '}\n';
  }
  template += '\n';

  var logOptions = {
    rev: revset,
    template: template
  };
  return repository.logRaw(logOptions, function(err, output) {
    if (err) return callback(err);

    var commits = output
      .split("\n\n")
      .map(parseCommitFromLines);

    commits = commits.map(_.compose(mapCommitSummary, mapCommitRev));
    return callback(null, commits);
  });
}
exports.getChangesetsByRevset = getChangesetsByRevset;

function parseCommitFromLines(rawLines) {
  var lines = rawLines.split("\n");
  return _.reduce(lines, reduceCommitLine, {});
}
exports.parseCommitFromLines = parseCommitFromLines;

function reduceCommitLine(commit, line) {
  var offset = line.indexOf(':');
  if (offset === -1) {
    throw new Error('invalid commit line: ' + line);
  }

  var key = line.substr(0, offset);
  var value = decodeURIComponent(line.substr(offset + 1));
  commit[key] = value;
  return commit;
}
exports.reduceCommitLine = reduceCommitLine;

function mapCommitSummary(commit) {
  if (commit.description) {
    var parts = parseCommitDescription(commit.description);
    commit.summary = parts[0];
    commit.spillover = parts[1];
  }
  return commit;
}
exports.mapCommitSummary = mapCommitSummary;

function mapCommitRev(commit) {
  if (commit.rev) {
    commit.rev = parseInt(commit.rev, 10);
  }
  return commit;
}
exports.mapCommitRev = mapCommitRev;

function parseCommitDescription(description) {
  var offset = description.indexOf("\n");
  if (offset === -1) {
    return [description, ""];
  }

  var summary = description.substr(0, offset).trim();
  var spillover = description.substr(offset + 1).trim();
  return [summary, spillover];
}
exports.parseCommitDescription = parseCommitDescription;

function extractBasicInfo(reviewRequest) {
  if (!reviewRequest) {
    return reviewRequest;
  }

  var result = {
    id: reviewRequest.id,
    url: reviewRequest.absolute_url,
    node: reviewRequest.commit_id,
    status: reviewRequest.status
  };

  if (reviewRequest.target_people.length) {
    // FIXME: multiple reviewers?
    result.reviewer = reviewRequest.target_people[0].title;
  }

  return result;
}
exports.extractBasicInfo = extractBasicInfo;

/**
 * Extracts Review Request ID from the API resource link
 *
 * Example:
 * Input: {href: "http://reviewboard.example.org/api/review-requests/42/"}
 * Output: 42
 *
 * @param  string reviewRequestLink
 * @return number
 */
function extractIdFromUrl(reviewRequestLink) {
  var parts = reviewRequestLink.href.split('/');
  var id = _(parts).compact().last();
  return parseInt(id, 10);
}
exports.extractIdFromUrl = extractIdFromUrl;
