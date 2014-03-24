var BUGZILLA_BUG_URL = 'http://bugzilla.mozilla.org/show_bug.cgi?id=';
var BUGZILLA_API_URL = 'https://api-dev.bugzilla.mozilla.org/latest';

var TEMPLATES = {};
var PARAMS = {};

var bhReviewers = new Bloodhound({
  datumTokenizer: function(d) {
    return Bloodhound.tokenizers.whitespace(d.username);
  },
  queryTokenizer: Bloodhound.tokenizers.whitespace,
  remote: '/api/reviewers/?q=%QUERY'
});

$(function(){
  compileTemplates();
  initTypeahead();
  new Spinner().spin(document.getElementById('loading'));

  var qs = window.location.search.substr(1);
  PARAMS = parseQueryString(qs);

  if (!PARAMS.changeset) {
    return renderError('no changeset provided in URI');
  }

  if (!PARAMS.bug) {
    return renderError('no bug provided in URI');
  }

  initMain();

  // event handlers
  $('#btnSelectAll').click(selectAll);
  $('#btnSelectNone').click(selectNone);
  $('#btnSubmit').click(submit);
});

function compileTemplates() {
  $('script[type="text/x-underscore"]').each(function(i, template) {
    var id = template.id;
    var code = template.innerHTML;
    TEMPLATES[id] = _.template(code);
  });
}

function initTypeahead() {
  bhReviewers.initialize();

  $('#reviewer').typeahead(null, {
    name: 'reviewers',
    displayKey: 'username',
    source: bhReviewers.ttAdapter()
  });
}

function initMain() {
  $('#loading').removeClass('hidden');

  var promiseBugInfo = loadBugInfo(PARAMS.bug);
  var promiseChangesets = loadChangesets(PARAMS.changeset);
  $.when(promiseBugInfo, promiseChangesets)
    .fail(function(xhr, textStatus, errorThrown) {
      renderError('request failed, please see logs');
    })
    .done(function(bugInfo, newChangesets) {
      renderBugInfo(bugInfo);
      renderParentReviewRequest(bugInfo.reviewRequest);

      var oldChangesets = [];
      if (bugInfo.reviewRequest && bugInfo.reviewRequest.changesets) {
        oldChangesets = bugInfo.reviewRequest.changesets;
      }

      var actuallyNewChangesets = filterChangesets(oldChangesets, newChangesets);

      renderOldChangesets(oldChangesets);
      renderNewChangesets(actuallyNewChangesets);
    })
    .always(function() {
      $('#loading').addClass('hidden');
    });
}

// returns the difference between old and new changesets
function filterChangesets(oldChangesets, newChangesets) {
  var lookup = {};
  oldChangesets.forEach(function(changeset) {
    lookup[changeset.id] = true;
  });

  var result = newChangesets.filter(function(changeset) {
    return !lookup[changeset.id];
  });
  return result;
}

function loadChangesets(changeset) {
  var url = '/api/changesets/' + changeset;
  return $.get(url).then(function(changesets) {
    return changesets;
  });
}

function loadBugInfo(bug) {
  var url = '/api/bugs/' + bug;
  return $.get(url).then(function(bugInfo) {
    bugInfo.number = bug;
    return bugInfo;
  });
}

function renderBugInfo(bugInfo) {
  var html = TEMPLATES.bugInfo(bugInfo);
  $('#bug').html(html);
}

function renderOldChangesets(changesets) {
  var rows = changesets.map(TEMPLATES.oldChangesetRow);
  $('#old-changesets-table tbody').html(rows.join(""));
  $('#old-changesets-table button.delete').click(removeFromReview);
  $('#old-changesets').removeClass('hidden');
}

function renderNewChangesets(changesets) {
  var rows = changesets.map(TEMPLATES.newChangesetRow);
  $('#new-changesets-table tbody').html(rows.join(""));
  $('#new-changesets-table tbody tr').click(onRowClick);
  $('#new-changesets').removeClass('hidden');
  updateControls();
}

function renderParentReviewRequest(parentReviewRequest) {
  if (parentReviewRequest) {
    var html = TEMPLATES.parentReviewRequestInfo(parentReviewRequest);
    $('#parentReviewRequest').html(html);

    if (parentReviewRequest.reviewer) {
      $('#reviewer').val(parentReviewRequest.reviewer);
    }
  } else {
    $('#parentReviewRequest').html('not created yet');
    $('#reviewer').val('');
  }
}

function renderError(message) {
  $('#errorbox .message').text(message);
  $('#errorbox').removeClass('hidden');
}

function renderSuccess(message) {
  $('#messagebox').removeClass('hidden').html(message);
}

function onRowClick(e) {
  selectRow(e.currentTarget);
}

function submit() {
  var selectedRows = getSelectedRows();
  var revs = selectedRows.get().map(function(row) {
    return row.dataset.node;
  });
  var reviewer = $('#reviewer').val();
  var request = {
    revs: revs,
    reviewer: reviewer,
    bug: PARAMS.bug
  };

  var btnSubmit = $('#btnSubmit');
  btnSubmit.button('loading');

  $.post('/api/review-requests/', request, function(results) {
    initMain();
  }).fail(function(xhr, textStatus, errorThrown) {
    renderError('failed to create review requests');
  }).always(function() {
    btnSubmit.button('reset');
  });
}

function removeFromReview(e) {
  var id = e.currentTarget.dataset.id;
  var url = '/api/review-requests/' + id;
  $.ajax({
    url: url,
    type: 'DELETE',
    success: function() {
      initMain();
    },
    error: function() {
      renderError('failed to delete review request');
    }
  })
}


function selectRow(row) {
  row = $(row);
  if (row.hasClass('info')) {
    return;
  }

  row.toggleClass('success');
  updateControls();
}

function selectAll() {
  $('#new-changesets tbody tr').not('.info').addClass('success');
  updateControls();
}

function selectNone() {
  $('#new-changesets tbody tr').not('.info').removeClass('success');
  updateControls();
}

function getSelectedRows() {
  return $('#new-changesets tbody tr.success');
}

function updateControls() {
  var submit = $('#btnSubmit');
  var selectedRows = getSelectedRows();
  if (selectedRows.length) {
    submit.removeAttr('disabled');
  } else {
    submit.attr('disabled', 'disabled');
  }
}

function parseQueryString(qs) {
  var result = {};
  var parts = qs.split('&');
  parts.forEach(function(part) {
    var offset = part.indexOf('=');
    if (offset === -1) {
      result[part] = true;
      return;
    }

    var k = part.substr(0, offset);
    var v = part.substr(offset + 1);
    result[k] = v;
  });
  return result;
}
