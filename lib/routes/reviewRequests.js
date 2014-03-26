var models = require('../models');

module.exports = function(app) {
  app.post('/api/review-requests/', routeCreateReviewRequest);
  app.post('/api/review-requests/:id/discard', routeDiscardReviewRequest);
  app.post('/api/review-requests/:id/rewrite', routeRewriteReviewRequest);
};

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

  // FIXME: context is a crappy name
  var context = {
    reviewer: reviewer,
    bug: bug
  };
  return models.doCreateReviewRequest(context, revs, function(err, result) {
    if (err) return next(err);
    return res.send(result);
  });
}

function routeDiscardReviewRequest(req, res, next) {
  var id = req.params.id;
  if (!id) {
    return res.send(400, 'no id');
  }

  return models.doDiscardReviewRequest(id, function(err) {
    if (err) return next(err);
    return res.send();
  });
}

function routeRewriteReviewRequest(req, res, next) {
  var id = req.params.id;
  if (!id) {
    return res.send(400, 'no id');
  }

  var rev = req.body.rev;
  if (!rev) {
    return res.send(400, 'no rev');
  }

  return models.rewriteReviewRequest(id, rev, function(err, reviewRequest) {
    if (err) return next(err);

    var info = models.extractBasicInfo(reviewRequest);
    return res.send(info);
  });
}
