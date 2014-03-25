var models = require('../models');

module.exports = function(app) {
  app.get('/api/reviewers/', routeFindReviewers);
};

function routeFindReviewers(req, res, next) {
  var query = req.query.q;
  return models.findReviewers(query, function(err, reviewers) {
    if (err) return next(err);
    return res.send(reviewers);
  });
}
