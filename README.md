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
5. Add the following `changegroup` hook to the `.hg/hgrc` file
    in the central Mercurial repository:

        [hooks]
        changegroup = /usr/bin/env \
            URL=http://localhost:5000/ \
            /path/to/changeset-chooser/bin/hooks/changegroup

    Replace `http://localhost:5000` with the public address of changeset-chooser.


Usage
-----

Push some commits from your local repository to the central repository and
you'll see a link to changeset chooser:

    $ hg push
    pushing to http://localhost:8000/
    searching for changes
    remote: adding changesets
    remote: adding manifests
    remote: adding file changes
    remote: added 1 changesets with 1 changes to 1 files
    remote: choose changesets to review: http://localhost:5000/?e31b9b299ef3f70848524df94908be3819501546


API
---

See the list of the last 3 changesets:

    $ curl 'http://localhost:5000/api/changesets/tip~2'
    [
      {
        "id": "896d46402a03",
        "node": "896d46402a03ddea6318e102673b07ad6d41fe9d",
        "author": "George Miroshnykov <george.miroshnykov@gmail.com>",
        "user": "george",
        "date": "2014-02-28 15:00:09 +0200",
        "description": "Yeah!",
        "summary": "Yeah!",
        "spillover": "",
        "reviewRequest": null
      },
      {
        "id": "b3dcc5460e65",
        "node": "b3dcc5460e653c96e401ff5e196b446cd5300e1d",
        "author": "George Miroshnykov <george.miroshnykov@gmail.com>",
        "user": "george",
        "date": "2014-02-28 16:15:17 +0200",
        "description": "Lots of line\n\n\n\n\nSrsly, lines!",
        "summary": "Lots of line",
        "spillover": "Srsly, lines!",
        "reviewRequest": {
          "id": 70,
          "url": "http://rb.dev/r/70/"
        }
      },
      {
        "id": "92839660cc25",
        "node": "92839660cc25dce72dc98b3b2327f1b10d25605f",
        "author": "George Miroshnykov <george.miroshnykov@gmail.com>",
        "user": "george",
        "date": "2014-03-03 17:24:06 +0200",
        "description": "Is this awesome?\nI'm sure it is!",
        "summary": "Is this awesome?",
        "spillover": "I'm sure it is!",
        "reviewRequest": {
          "id": 69,
          "url": "http://rb.dev/r/69/"
        }
      }
    ]

Create review requests for specific changesets:

    $ curl 'http://localhost:5000/api/create-review-request' \
        -H 'Content-Type: application/json' \
        -d '{"revs":["896d46402a03", "b3dcc5460e65", "92839660cc25"]}'
    {
      "896d46402a03": {
        "id": 28,
        "url": "http://rb.dev/r/28/"
      },
      "b3dcc5460e65": {
        "id": 70,
        "url": "http://rb.dev/r/70/"
      },
      "92839660cc25": {
        "id": 69,
        "url": "http://rb.dev/r/69/"
      }
    }

The same thing, but with form request:

    $ curl 'http://localhost:5000/api/create-review-request' \
        -d 'revs[]=896d46402a03' \
        -d 'revs[]=b3dcc5460e65' \
        -d 'revs[]=92839660cc25'
