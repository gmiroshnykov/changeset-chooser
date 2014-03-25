var models = require('../models');

module.exports = function(app) {
  app.get('/api/changesets/:rev', routeFindChangesets);
};

function routeFindChangesets(req, res, next) {
  var rev = req.params.rev;
  if (!rev) {
    return res.send(400, 'no rev');
  }

  // find all changesets from the given one till tip
  var revset = rev + ':';
  return models.getChangesetsByRevset(revset, function(err, changesets) {
    if (err) return next(err);
    return res.send(changesets);
  });
}
