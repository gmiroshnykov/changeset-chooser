var TEMPLATES = {};

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

  var changeset = window.location.search.substr(1);
  if (!changeset) {
    return renderError('no changeset provided in URI');
  }

  loadChangesets(changeset);

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

function renderChangesets(changesets) {
  var rows = changesets.map(TEMPLATES.changesetRow);
  $('#changesets tbody').html(rows.join(""));
  $('#changesets tbody tr').click(onRowClick);
}

function renderError(message) {
  $('#errorbox .message').text(message);
  $('#errorbox').removeClass('hidden');
}

function onRowClick(e) {
  selectRow(e.currentTarget);
}

function submit() {
  var selectedRows = getSelectedRows();
  var revs = selectedRows.get().map(function(row) {
    return row.dataset.id;
  });
  var reviewer = $('#reviewer').val();
  var request = {
    revs: revs,
    reviewer: reviewer
  };

  var btnSubmit = $('#btnSubmit');
  btnSubmit.button('loading');

  $.post('/api/create-review-request', request, function(results) {
    for (var k in results) {
      var shortReviewRequest = results[k];
      var row = $('#changesets tbody tr[data-id="' + k + '"]');
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
