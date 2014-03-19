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

  var qs = window.location.search.substr(1);
  PARAMS = parseQueryString(qs);

  if (!PARAMS.changeset) {
    return renderError('no changeset provided in URI');
  }

  if (!PARAMS.bug) {
    return renderError('no bug provided in URI');
  }

  //loadChangesets(PARAMS.changeset);
  loadBugInfo(PARAMS.bug);

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

function loadChangesets(changeset) {
  var url = '/api/changesets/' + changeset;
  $.get(url, function(changesets) {
    //console.log(changesets);
    renderChangesets(changesets);
  }).fail(function(xhr, textStatus, errorThrown) {
    renderError('failed to load changesets');
  });
}

function loadBugInfo(bug) {
  var url = '/api/bugs/' + bug;
  $.get(url, function(res) {
    //console.log(res);
    var params = {
      number: bug,
      url: res.url,
      summary: res.summary
    };
    var html = TEMPLATES.bugInfo(params);
    $('#bug').html(html);

    renderParentReviewRequest(res.reviewRequest);

    if (res.reviewRequest && res.reviewRequest.changesets) {
      renderChangesets(res.reviewRequest.changesets);
    }
  });
}

function renderChangesets(changesets) {
  var rows = changesets.map(TEMPLATES.changesetRow);
  $('#changesets tbody').html(rows.join(""));
  $('#changesets tbody tr').click(onRowClick);
}

function renderParentReviewRequest(parentReviewRequest) {
  if (parentReviewRequest) {
    var html = TEMPLATES.parentReviewRequestInfo(parentReviewRequest);
    $('#parentReviewRequest').html(html);
  } else {
    $('#parentReviewRequest').html('not created yet');
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

  $.post('/api/create-review-request', request, function(results) {
    var parent = results.parent;
    renderParentReviewRequest(parent);

    var children = results.children;
    for (var k in children) {
      var shortReviewRequest = children[k];
      var node = shortReviewRequest.node;

      var row = $('#changesets tbody tr[data-node="' + node + '"]');
      row.removeClass('success');
      row.addClass('info');

      var tdReviewRequest = row.find('td.review-request');
      var html = TEMPLATES.tdReviewRequest(shortReviewRequest);
      tdReviewRequest.html(html);
      tdReviewRequest.removeClass('text-muted');
    }

  }).fail(function(xhr, textStatus, errorThrown) {
    renderError('failed to create review requests');
  }).always(function() {
    btnSubmit.button('reset');
  });
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
  $('#changesets tbody tr').not('.info').addClass('success');
  updateControls();
}

function selectNone() {
  $('#changesets tbody tr').not('.info').removeClass('success');
  updateControls();
}

function getSelectedRows() {
  return $('#changesets tbody tr.success');
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
