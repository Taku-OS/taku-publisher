# Preview real usage with the local Studio

Start the website checkout's loopback preview server:

```sh
cd <taku-landing-page-checkout>
node scripts/stax-studio-visual-preview.mjs
```

Generate a new draft from local usage without uploading a cloud draft:

```sh
cd <taku-publisher-checkout>
node scripts/taku-publisher.mjs creator-draft --json \
  --local-studio-preview http://127.0.0.1:3003 --workspace <project>
```

Reuse a local draft with `creator-editor --draft <draft.json>
--local-studio-preview http://127.0.0.1:3003 --json`. Open the exact returned
`editorUrl`. This option also works through the portable CLI in all three hosts.
HTTP loopback addresses only are accepted; redirects and returned links to
another origin are rejected.

Only the public Studio display model is sent to the in-memory local server.
Raw scan data, private inventory and authorization credentials are not sent.
The draft stays on disk, editing stays in the browser, and cloud saving and
public publishing are disabled. Existing authorized profile data can be read
during the scan; unsupported fields stay locked and partial samples stay partial.
The local preview supports Full/Mini and PNG using the website's current styles.

Session links expire after 12 hours or a preview-server restart. Rerun the
command to refresh the preview. Ordinary cloud Studio commands keep their
existing authorization and revision checks.
