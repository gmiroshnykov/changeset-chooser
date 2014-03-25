var async = require('async');
var models = require('../models');

module.exports = function(app) {
  app.get('/api/bugs/:bugId', routeGetBug);
};

function routeGetBug(req, res, next) {
  var bugId = req.params.bugId;
  if (!bugId) {
    return res.send(400, 'no bug id');
  }

  var fns = [
    models.getBug.bind(null, bugId),
    models.getExistingParentReviewRequest.bind(null, bugId)
  ];
  return async.parallel(fns, function(err, results) {
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
