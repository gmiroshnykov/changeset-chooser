changeset-chooser
=================

This tool allows you to:

1. View the list of changesets pending review.
2. Create [ReviewBoard](http://www.reviewboard.org/) review requests
for chosen changesets.


Requirements
------------

* Node.js v0.10+
* Mercurial (tested on v2.9)
* ReviewBoard 2.0+


Setup
-----

1. Create (or clone) a Mercurial repository in the local filesystem.
2. Add this repository to ReviewBoard.
3. Run `npm install`.
4. Change the values in `config.js`, then run `./bin/changeset-chooser`.


API
---

See the list of the last 3 changesets:

    $ curl 'http://localhost:5000/changesets/?rev=tip~2:'
    [
      {
        "changeset": "69:896d46402a03",
        "user": "George Miroshnykov <george.miroshnykov@gmail.com>",
        "date": "Fri Feb 28 15:00:09 2014 +0200",
        "summary": "Yeah!",
        "id": "896d46402a03",
        "rev": "69"
      },
      {
        "changeset": "70:b3dcc5460e65",
        "user": "George Miroshnykov <george.miroshnykov@gmail.com>",
        "date": "Fri Feb 28 16:15:17 2014 +0200",
        "summary": "Lots of line",
        "id": "b3dcc5460e65",
        "rev": "70"
      },
      {
        "changeset": "71:92839660cc25",
        "tag": "tip",
        "user": "George Miroshnykov <george.miroshnykov@gmail.com>",
        "date": "Mon Mar 03 17:24:06 2014 +0200",
        "summary": "Is this awesome?",
        "id": "92839660cc25",
        "rev": "71"
      }
    ]

Create a review request for a specific changeset:

    $ curl 'http://localhost:5000/create-review-request' -d rev=92839660cc25
    {
      "status": "pending",
      "last_updated": "2014-03-03T16:21:55Z",
      "links": {
        "diffs": {
          "href": "http://rb.dev/api/review-requests/45/diffs/",
          "method": "GET"
        },
        "repository": {
          "href": "http://rb.dev/api/repositories/1/",
          "method": "GET",
          "title": "playground-central"
        },
        "screenshots": {
          "href": "http://rb.dev/api/review-requests/45/screenshots/",
          "method": "GET"
        },
        "self": {
          "href": "http://rb.dev/api/review-requests/45/",
          "method": "GET"
        },
        "update": {
          "href": "http://rb.dev/api/review-requests/45/",
          "method": "PUT"
        },
        "last_update": {
          "href": "http://rb.dev/api/review-requests/45/last-update/",
          "method": "GET"
        },
        "reviews": {
          "href": "http://rb.dev/api/review-requests/45/reviews/",
          "method": "GET"
        },
        "file_attachments": {
          "href": "http://rb.dev/api/review-requests/45/file-attachments/",
          "method": "GET"
        },
        "draft": {
          "href": "http://rb.dev/api/review-requests/45/draft/",
          "method": "GET"
        },
        "diff_context": {
          "href": "http://rb.dev/api/review-requests/45/diff-context/",
          "method": "GET"
        },
        "submitter": {
          "href": "http://rb.dev/api/users/admin/",
          "method": "GET",
          "title": "admin"
        },
        "changes": {
          "href": "http://rb.dev/api/review-requests/45/changes/",
          "method": "GET"
        },
        "delete": {
          "href": "http://rb.dev/api/review-requests/45/",
          "method": "DELETE"
        }
      },
      "depends_on": [],
      "issue_resolved_count": 0,
      "ship_it_count": 0,
      "id": 45,
      "target_people": [],
      "changenum": null,
      "bugs_closed": [],
      "testing_done": "",
      "branch": "",
      "time_added": "2014-03-03T16:21:55Z",
      "extra_data": {},
      "public": true,
      "commit_id": null,
      "blocks": [],
      "description": "I'm sure it is!",
      "text_type": "plain",
      "issue_open_count": 0,
      "approved": false,
      "url": "/r/45/",
      "absolute_url": "http://rb.dev/r/45/",
      "target_groups": [],
      "summary": "Is this awesome?",
      "issue_dropped_count": 0,
      "approval_failure": "The review request has not been marked \"Ship It!\""
    }
