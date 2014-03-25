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

See `lib/routes/`.
