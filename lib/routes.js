var async = require('async'),
    _ = require('lodash');
var Repository = require('./repository'),
    ReviewBoard = require('./reviewboard');
var config = require('../config');
var repository = new Repository(config.REPOSITORY);

var rbOptions = {
  url: config.REVIEWBOARD_URL,
  username: config.REVIEWBOARD_USERNAME,
  password: config.REVIEWBOARD_PASSWORD
};
var reviewboard = new ReviewBoard(rbOptions);

module.exports = function(app) {
  app.get('/ping', function(req, res, next) {
    return res.send({pong: true});
  });

  app.get('/changesets/', function(req, res, next) {
    var logOptions = {};
    if (req.query.rev) {
      logOptions.rev = req.query.rev;
    }
    return repository.log(logOptions, function(err, changesets) {
      if (err) return next(err);
      return res.send(changesets);
    });
  });

  app.post('/create-review-request', function(req, res, next) {
    var rev = req.body.rev;
    if (!rev) {
      return res.send(400, 'no rev');
    }

    return createReviewRequest(rev, function(err, reviewRequest) {
      if (err) return next(err);
      return res.send(reviewRequest);
    });
  });
};

function createReviewRequest(revset, callback) {
  return getChangesetsByRevset(revset, function(err, changesets) {
    if (err) return callback(err);
    return async.map(changesets, createReviewRequestPart, function(err, reviewRequestParts) {
      if (err) return callback(err);
      if (reviewRequestParts.length === 1) {
        return callback(null, reviewRequestParts[0]);
      }
      return callback(null, reviewRequestParts);
    });
  });
}

function createReviewRequestPart(changeset, callback) {
  var options = {
    // commitId: changeset.node
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
          // commitId: changeset.node,
          summary: changeset.summary,
          description: changeset.spillover
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

function getChangesetsByRevset(revset, callback) {
  var logOptions = {
    rev: revset,
    template: 'node:{node}\ndescription:{desc|urlescape}\n\n'
  };
  return repository.logRaw(logOptions, function(err, output) {
    if (err) return next(err);
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
