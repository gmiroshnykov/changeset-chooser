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

    var revset = rev + ':';
    return getChangesetsByRevset(revset, function(err, changesets) {
      if (err) return next(err);
      return findReviewRequests(changesets, function(err, reviewRequests) {
        var reviewRequestInfos = reviewRequests.map(function(reviewRequest) {
          return {reviewRequest: extractBasicInfo(reviewRequest)};
        });
        var result = _.merge(changesets, reviewRequestInfos);
        return res.send(result);
      });
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

    var context = {
      reviewer: req.body.reviewer,
      bug: req.body.bug
    };
    return createReviewRequests(context, revs, function(err, reviewRequests) {
      if (err) return next(err);
      var basicInfos = reviewRequests.map(extractBasicInfo);
      var results = _.zipObject(revs, basicInfos);
      return res.send(results);
    });
  });

  app.get('/api/reviewers/', function(req, res, next) {
    var query = {
      'max-results': 15,
      'fullname': true
    };

    if (req.query.q) {
      query.q = req.query.q;
    }

    return reviewboard.findUsers(query, function(err, users) {
      if (err) return next(err);
      var shortUsers = users.map(function(user) {
        return _.pick(user, 'id', 'username', 'fullname', 'email');
      });
      return res.send(shortUsers);
    });
  });
};

function createReviewRequests(context, revs, callback) {
  return getChangesetsByRevsets(revs, function(err, changesets) {
    if (err) return callback(err);
    return async.mapLimit(changesets,
      config.ASYNC_LIMIT,
      findOrCreateReviewRequest.bind(null, context),
      callback
    );
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
  var options = {
    commitId: changeset.node
  };
  return reviewboard.createReviewRequest(options, function(err, reviewRequest) {
    if (err) return callback(err);

    var options = {
      rev: changeset.node
    };
    return repository.export(options, function(err, diff) {
      if (err) return callback(err);

      return reviewboard.uploadDiff(reviewRequest.id, diff, function(err, diff) {
        if (err) return callback(err);

        var options = {
          commitId: changeset.node,
          summary: changeset.summary,
          description: changeset.spillover,
          targetPeople: context.reviewer,
          bugsClosed: context.bug
        };
        return reviewboard.createReviewRequestDraft(reviewRequest.id, options,
          function(err, reviewRequestDraft) {
            if (err) return callback(err);

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
    url: reviewRequest.absolute_url
  };
}
