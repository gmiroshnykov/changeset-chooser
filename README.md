changeset-chooser
=================

This tool allows you to:

1. View the list of changesets pending review.
2. Choose a reviewer.
3. See a corresponding Bugzilla bug.
4. Create [ReviewBoard](http://www.reviewboard.org/) review requests
based on the above.


Requirements
------------

* Node.js v0.10+
* Mercurial (tested on v2.9)
* ReviewBoard 2.0+


Setup
-----

1. Create (or clone) a Mercurial repository in the local filesystem.
This will be a "review" repository.
2. Add the review repository to ReviewBoard using local filesystem (not SSH or HTTPS).
3. Run `npm install`.
4. Change the values in `config.js`, then run `./bin/changeset-chooser`.
5. Add the following hook to the `.hg/hgrc` file in the review repository:

        [hooks]
        pretxnchangegroup = /usr/bin/env \
            URL=http://localhost:5000/ \
            /path/to/changeset-chooser/bin/hooks/pretxnchangegroup

    Replace `http://localhost:5000` with the public address of the changeset-chooser.

6. Add the following line to `/etc/ssh/sshd_config`:

        AcceptEnv BUG

7. Restart SSH service:

        sudo restart ssh


Usage
-----

Do a `hg push` and specify the correct BUG like this:

    $ BUG=31337 hg push -e 'ssh -o SendEnv=BUG'
    pushing to ssh://review.infinity.com.ua//var/hg/playground-central
    searching for changes
    remote: adding changesets
    remote: adding manifests
    remote: adding file changes
    remote: added 1 changesets with 1 changes to 1 files
    remote: choose changesets to review: http://review.infinity.com.ua:5000/?changeset=b43890fa6f7411c1f3f31bd2c701c1656892d608&bug=31337

In case you'll try to do a regular `hg push`, it will fail like this:

    $ hg push
    pushing to ssh://review.infinity.com.ua//var/hg/playground-central
    searching for changes
    remote: adding changesets
    remote: adding manifests
    remote: adding file changes
    remote: added 1 changesets with 1 changes to 1 files
    remote: ERROR: BUG not set
    remote: transaction abort!
    remote: rollback completed
    remote: abort: pretxnchangegroup hook exited with status 1


API
---

### `GET /api/bugs/:bugId`

Get Bugzilla bug info

Example:

    GET /api/bug/31337

Response:

```json
{
    "reviewRequest": {
        "changesets": [],
        "id": 5,
        "node": "bug-31337",
        "reviewer": "admin",
        "status": "pending",
        "url": "http://rb.dev/r/5/"
    },
    "summary": "Can't type in password for authentication",
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=31337"
}
```

### `GET /api/reviewers/?q=<name>`

Find reviewers by name (reviewer suggestion).

Example:

    GET /api/reviewers/?q=adm

Response:

```json
[
    {
        "email": "admin",
        "fullname": "",
        "id": 1,
        "username": "admin"
    }
]
```

### `GET /api/changesets/:rev`

Get the list of changesets descending from the given revision.

Example:

    GET /api/changesets/546daffaecd7

Response:

```json
[
    {
        "author": "George Miroshnykov <george.miroshnykov@gmail.com>",
        "date": "2014-03-07 13:01:45 +0200",
        "description": "Hello",
        "id": "546daffaecd7",
        "node": "546daffaecd7a87ac6e743a44cce48e4b8657101",
        "rev": 81,
        "reviewRequest": null,
        "spillover": "",
        "summary": "Hello",
        "user": "george"
    },
    {
        "author": "George Miroshnykov <george.miroshnykov@gmail.com>",
        "date": "2014-03-07 13:07:11 +0200",
        "description": "World",
        "id": "3baf77c5621a",
        "node": "3baf77c5621ab0ec437289b9740ca11a3ab7668a",
        "rev": 82,
        "reviewRequest": {
            "id": 54,
            "node": "3baf77c5621ab0ec437289b9740ca11a3ab7668a",
            "reviewer": "admin",
            "status": "pending",
            "url": "http://rb.dev/r/54/"
        },
        "spillover": "",
        "summary": "World",
        "user": "george"
    },
    {
        "author": "George Miroshnykov <george.miroshnykov@gmail.com>",
        "date": "2014-03-07 13:09:01 +0200",
        "description": "Foobar",
        "id": "ef309f100e2d",
        "node": "ef309f100e2d2310da2a79e1b17f633a7e8dc70f",
        "rev": 83,
        "reviewRequest": null,
        "spillover": "",
        "summary": "Foobar",
        "user": "george"
    }
]
```

### `POST /api/review-requests/`

Create or update review request.

Params:

* `revs` - array of changeset IDs
* `bug` - Bugzilla bug number
* `reviewer` - [optional] reviewer name

Example:

    POST /api/review-requests/
    {
        "revs": [
            "546daffaecd7a87ac6e743a44cce48e4b8657101",
            "3baf77c5621ab0ec437289b9740ca11a3ab7668a",
            "ef309f100e2d2310da2a79e1b17f633a7e8dc70f"
        ],
        "bug": 31337,
        "reviewer": "admin"
    }


Response:

```json
{
    "children": [
        {
            "id": 54,
            "node": "3baf77c5621ab0ec437289b9740ca11a3ab7668a",
            "reviewer": "admin",
            "status": "pending",
            "url": "http://rb.dev/r/54/"
        },
        {
            "id": 55,
            "node": "ef309f100e2d2310da2a79e1b17f633a7e8dc70f",
            "status": "pending",
            "url": "http://rb.dev/r/55/"
        },
        {
            "id": 56,
            "node": "546daffaecd7a87ac6e743a44cce48e4b8657101",
            "status": "pending",
            "url": "http://rb.dev/r/56/"
        }
    ],
    "parent": {
        "id": 5,
        "node": "bug-31337",
        "reviewer": "admin",
        "status": "pending",
        "url": "http://rb.dev/r/5/"
    }
}
```

### `POST /api/review-requests/:id/discard`

Discard a child review request.

Example:

    POST /api/review-requests/54/discard

Response:

    200 OK (empty)

### `POST /api/review-requests/:id/rewrite`

Rewrite history by changing the changeset of existing review request.

Params:

* `rev` - new changeset ID to be associated with the review request

Example:

    POST /api/review-requests/56/rewrite
    {
        "rev": "3baf77c5621ab0ec437289b9740ca11a3ab7668a"
    }

Response:

```json
{
    "id": 56,
    "node": "3baf77c5621ab0ec437289b9740ca11a3ab7668a",
    "reviewer": "admin",
    "status": "pending",
    "url": "http://rb.dev/r/56/"
}
```
