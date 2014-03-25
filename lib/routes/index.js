module.exports = function(app) {
  require('./bugs')(app);
  require('./changesets')(app);
  require('./reviewers')(app);
  require('./reviewRequests')(app);
};
