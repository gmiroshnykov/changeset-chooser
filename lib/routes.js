var async = require('async'),
    _ = require('lodash');
var Repository = require('./repository'),
    ReviewBoard = require('./reviewboard');
var config = require('../config');
var repository = new Repository(config.REPOSITORY);

var rbOptions = {
  url: config.REVIEWBOARD_URL,
  username: config.REVIEWBOARD_USERNAME,
  password: config.REVIEWBOARD_PASSWORD,
  repository: config.REVIEWBOARD_REPOSITORY
};
var reviewboard = new ReviewBoard(rbOptions);

module.exports = function(app) {
  app.get('/api/changesets/:rev', function(req, res, next) {
    var rev = req.params.rev;
    if (!rev) {
      return res.send(400, 'no rev');
    }

    return doFindChangesets(rev, function(err, result) {
      if (err) return next(err);
      return res.send(result);
    });
  });

  app.post('/api/create-review-request', function(req, res, next) {
    var revs = req.body.revs;
    if (!revs) {
      return res.send(400, 'no revs');
    }

    if (!Array.isArray(revs)) {
      revs = [revs];
    }

    var bug = req.body.bug;
    if (!bug) {
      return res.send(400, 'no bug');
    }

    var context = {
      reviewer: req.body.reviewer,
      bug: bug
    };

    return doCreateReviewRequest(context, revs, function(err, result) {
      if (err) return next(err);
      return res.send(result);
    });
  });

  app.get('/api/reviewers/', function(req, res, next) {
    var q = req.query.q;
    return doFindReviewers(q, function(err, reviewers) {
      if (err) return next(err);
      return res.send(reviewers);
    });
  });
};

function doFindChangesets(rev, callback) {
  // find all changesets from the given one till tip
  var revset = rev + ':';
  return getChangesetsByRevset(revset, function(err, changesets) {
    if (err) return callback(err);

    // find any existing review requests for our changesets
    return findReviewRequests(changesets, function(err, reviewRequests) {
      if (err) return callback(err);

      // merge review request info into changeset info
      var reviewRequestInfos = reviewRequests.map(function(reviewRequest) {
        return {reviewRequest: extractBasicInfo(reviewRequest)};
      });
      var result = _.merge(changesets, reviewRequestInfos);
      return callback(null, result);
    });
  });
}

function doFindReviewers(q, callback) {
  var query = {
    'max-results': 15,
    'fullname': true
  };

  if (q) {
    query.q = q
  }

  return reviewboard.findUsers(query, function(err, users) {
    if (err) return callback(err);
    var reviewers = users.map(function(user) {
      return _.pick(user, 'id', 'username', 'fullname', 'email');
    });
    return callback(null, reviewers);
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
  // FIXME: RB API won't allow us to search for existing review requests
  // by bug number, so we have to abuse commit_id field instead
  var options = {
    commitId: 'bug-' + bug
  };
  return reviewboard.findReviewRequest(options, function(err, parentReviewRequest) {
    if (err) return callback(err);
    if (parentReviewRequest) return callback(null, parentReviewRequest);

    return reviewboard.createReviewRequest(options, callback);
  });
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
  var template = 'id:{node|short}\nnode:{node}\n'+
    'author:{author}\nuser:{author|user}\n' +
    'date:{date|isodatesec}\n' +
    'description:{desc|urlescape}\n\n';

  var logOptions = {
    rev: revset,
    template: template
  };
  return repository.logRaw(logOptions, function(err, output) {
    if (err) return callback(err);
    var commits = output.split("\n\n");
    commits = commits.map(parseCommitFromLines);
    commits = commits.map(mapCommitSummary);
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

  return {
    id: reviewRequest.id,
    url: reviewRequest.absolute_url,
    node: reviewRequest.commit_id
  };
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
