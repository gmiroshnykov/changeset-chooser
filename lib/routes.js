var async = require('async'),
    _ = require('lodash');
var Repository = require('./repository'),
    ReviewBoard = require('./reviewboard'),
    Bugzilla = require('./bugzilla');
var config = require('../config');

var repository = new Repository(config.REPOSITORY);

var rbOptions = {
  url: config.REVIEWBOARD_URL,
  username: config.REVIEWBOARD_USERNAME,
  password: config.REVIEWBOARD_PASSWORD,
  repository: config.REVIEWBOARD_REPOSITORY
};
var reviewboard = new ReviewBoard(rbOptions);

var bzOptions = {
  url: config.BUGZILLA_URL,
  apiUrl: config.BUGZILLA_API_URL
};
var bugzilla = new Bugzilla(bzOptions);

module.exports = function(app) {
  app.get('/api/bugs/:bugId', routeFindBug);
  app.get('/api/changesets/:rev', routeFindChangesets);
  app.get('/api/reviewers/', routeFindReviewers);
  app.post('/api/create-review-request', routeCreateReviewRequest);
  app.del('/api/review-requests/:id', routeDeleteReviewRequest);
};

function routeFindBug(req, res, next) {
  var bugId = req.params.bugId;
  if (!bugId) {
    return res.send(400, 'no bug id');
  }

  return async.parallel([
    getBugInfo.bind(null, bugId),
    getExistingParentReviewRequest.bind(null, bugId)
  ], function(err, results) {
    if (err) return next(err);

    var bugInfo = results[0],
        parentReviewRequest = results[1];

    if (!bugInfo) {
      return res.send(400, 'bug not found: ' + bugId);
    }

    bugInfo.reviewRequest = parentReviewRequest;

    return res.send(bugInfo);
  });
}

function getBugInfo(bugId, callback) {
  var options = {
    includeFields: 'summary'
  };
  return bugzilla.getBug(bugId, options, callback);
}

function getExistingParentReviewRequest(bugId, callback) {
  return findParentReviewRequest(bugId, function(err, parentReviewRequest) {
    if (err) return callback(err);
    if (!parentReviewRequest) {
      // there's no parent review requests yet
      return callback(null, null);
    }

    var childReviewRequestIds = parentReviewRequest.depends_on.map(extractDependsOn);
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

function routeFindChangesets(req, res, next) {
  var rev = req.params.rev;
  if (!rev) {
    return res.send(400, 'no rev');
  }

  // find all changesets from the given one till tip
  var revset = rev + ':';
  return getChangesetsByRevset(revset, function(err, changesets) {
    if (err) return next(err);
    return res.send(changesets);
  });
}

function routeFindReviewers(req, res, next) {
  var query = {
    'max-results': 15,
    'fullname': true
  };

  if (req.query.q) {
    query.q = req.query.q
  }

  return reviewboard.findUsers(query, function(err, users) {
    if (err) return next(err);
    var reviewers = users.map(function(user) {
      return _.pick(user, 'id', 'username', 'fullname', 'email');
    });
    return res.send(reviewers);
  });
}

function routeCreateReviewRequest(req, res, next) {
  var revs = req.body.revs;
  if (!revs) {
    return res.send(400, 'no revs');
  }

  if (!Array.isArray(revs)) {
    revs = [revs];
  }

  var reviewer = req.body.reviewer;

  var bug = req.body.bug;
  if (!bug) {
    return res.send(400, 'no bug');
  }

  var context = {
    reviewer: reviewer,
    bug: bug
  };
  return doCreateReviewRequest(context, revs, function(err, result) {
    if (err) return next(err);
    return res.send(result);
  });
}

function routeDeleteReviewRequest(req, res, next) {
  var id = req.params.id;
  if (!id) {
    return res.send(400, 'no id');
  }

  return reviewboard.deleteReviewRequest(id, function(err) {
    if (err) return next(err);
    return res.send();
  });
}

function doCreateReviewRequest(context, revs, callback) {
  // find or create individual review requests for every changeset
  return findOrCreateReviewRequests(context, revs, function(err, newReviewRequests) {
    if (err) return callback(err);

    newReviewRequests = _.indexBy(newReviewRequests, 'id');

    // find or create a parent review request
    return findOrCreateParentReviewRequest(context.bug, function(err, parentReviewRequest) {
      if (err) return callback(err);

      // get previously created review requests that are associated with our parent
      var existingReviewRequestIds = parentReviewRequest.depends_on.map(extractDependsOn);
      return getReviewRequests(existingReviewRequestIds,
        function(err, existingReviewRequests) {
          if (err) return callback(err);

          existingReviewRequests = _.indexBy(existingReviewRequests, 'id');

          // merge existing and new review requests
          var reviewRequests = {};
          _.assign(reviewRequests, existingReviewRequests, newReviewRequests);

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
    });
  });
}

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
    dependsOn: _.keys(reviewRequests)
  };
  return reviewboard.createReviewRequestDraft(id, options, callback);
}

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

function findParentReviewRequest(bug, callback) {
  // FIXME: RB API won't allow us to search for existing review requests
  // by bug number, so we have to abuse commit_id field instead
  var options = {
    commitId: 'bug-' + bug
  };
  return reviewboard.findReviewRequest(options, callback);
}

function getReviewRequests(ids, callback) {
  var getReviewRequest = reviewboard.getReviewRequest.bind(reviewboard);
  return async.mapLimit(ids, config.ASYNC_LIMIT, getReviewRequest, callback);
}

function findOrCreateReviewRequests(context, revs, callback) {
  return getChangesetsByRevsets(revs, function(err, changesets) {
    if (err) return callback(err);

    var f = findOrCreateReviewRequest.bind(null, context);
    return async.mapLimit(changesets, config.ASYNC_LIMIT, f, callback);
  });
}

function findOrCreateReviewRequest(context, changeset, callback) {
  return findReviewRequest(changeset, function(err, reviewRequest) {
    if (err) return callback(err);
    if (reviewRequest) return callback(null, reviewRequest);

    return createReviewRequest(context, changeset, callback);
  });
}

function findReviewRequests(changesets, callback) {
  return async.map(changesets, findReviewRequest, callback);
}

function findReviewRequest(changeset, callback) {
  var options = {
    commitId: changeset.node
  };
  return reviewboard.findReviewRequest(options, callback);
}

function createReviewRequest(context, changeset, callback) {
  // step 1: create review request
  var options = {
    commitId: changeset.node
  };
  return reviewboard.createReviewRequest(options, function(err, reviewRequest) {
    if (err) return callback(err);

    // step 2: get the changeset diff
    var options = {
      rev: changeset.node
    };
    return repository.export(options, function(err, diff) {
      if (err) return callback(err);

      // step3: attach changeset diff to review request
      return reviewboard.uploadDiff(reviewRequest.id, diff, function(err, diff) {
        if (err) return callback(err);

        // step 4: set review request details by creating review request draft
        var options = {
          commitId: changeset.node,
          summary: changeset.summary,
          description: changeset.spillover,
          targetPeople: context.reviewer,
          bugsClosed: context.bug
        };
        return reviewboard.createReviewRequestDraft(reviewRequest.id, options,
          function(err) {
            if (err) return callback(err);

            // step 5: read back review request details
            return reviewboard.getReviewRequest(reviewRequest.id, callback);
          }
        );
      });
    });
  });
}

function getChangesetsByRevsets(revs, callback) {
  return async.map(revs, getChangesetsByRevset, function(err, changesets) {
    if (err) return callback(err);
    changesets = _.flatten(changesets, true);
    return callback(null, changesets);
  });
}

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
    var commits = output.split("\n\n");
    // FIXME: refactor this to loop over commits only once
    commits = commits.map(parseCommitFromLines);
    commits = commits.map(mapCommitSummary);
    commits = commits.map(mapCommitRev);
    return callback(null, commits);
  });
}

function parseCommitFromLines(rawLines) {
  var lines = rawLines.split("\n");
  return _.reduce(lines, reduceCommitLine, {});
}

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

function mapCommitSummary(commit) {
  if (commit.description) {
    var parts = parseCommitDescription(commit.description);
    commit.summary = parts[0];
    commit.spillover = parts[1];
  }
  return commit;
}

function mapCommitRev(commit) {
  if (commit.rev) {
    commit.rev = parseInt(commit.rev, 10);
  }
  return commit;
}

function parseCommitDescription(description) {
  var offset = description.indexOf("\n");
  if (offset === -1) {
    return [description, ""];
  }

  var summary = description.substr(0, offset).trim();
  var spillover = description.substr(offset + 1).trim();
  return [summary, spillover];
}

function extractBasicInfo(reviewRequest) {
  if (!reviewRequest) {
    return reviewRequest;
  }

  var result = {
    id: reviewRequest.id,
    url: reviewRequest.absolute_url,
    node: reviewRequest.commit_id
  };

  if (reviewRequest.target_people.length) {
    // FIXME: multiple reviewers?
    result.reviewer = reviewRequest.target_people[0].title;
  }

  return result;
}

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
function extractDependsOn(reviewRequestLink) {
  var parts = reviewRequestLink.href.split('/');
  var id = _(parts).compact().last();
  return parseInt(id, 10);
}
