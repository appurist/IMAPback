# imapback

Small Bun IMAP diagnostic and backup tool.

Usage:

```powershell
bun run index.js mail.example.com password --user user@example.com --folders --counts
bun run index.js mail.example.com password --user user@example.com --search "Sent" --counts
bun run index.js mail.example.com password --user user@example.com --search "Fitness" --list
bun run index.js mail.example.com password --user user@example.com --search "Fitness" --list --date 20260501-
bun run index.js mail.example.com password --user user@example.com --list "INBOX.Sent"
bun run index.js mail.example.com password --user user@example.com --output ./backup
bun run index.js --counts
bun run index.js --config jon.cfg --counts
```

Arguments:

- `hostname`: required positional IMAP hostname.
- `password`: optional positional password. You can also set `IMAPSAVE_PASSWORD`.
- `--config <path>`, `-c <path>`: defaults file path, default `config.cfg`.
- `--user <value>`: IMAP username. You can also set `IMAPSAVE_USER`.
- `--connect-host <host>`: connect to this host or IP address while still using `hostname` for TLS SNI/certificate validation. Useful when DNS has moved but the old IMAP server is still available by IP.
- `--port <number>`: IMAPS port, default `993`.
- `--folders`: list all folders with relevant LIST attributes. Report output is sorted by folder name.
- `--counts`: fetch message counts for each folder with `STATUS` and relevant LIST attributes. Report output is sorted by folder name and prints a space-padded six-character count first.
- `--search <text>`, `-s <text>`: include matching folder names in folder, count, and backup output. When used by itself, it prints matching folder names.
- `--list [folder]`, `-l [folder]`: list message UID plus the raw `Date`, `From`, and `Subject` headers for matched folders. With `--search`, the search text selects folders. Without `--search`, an optional folder argument is matched exactly; omitting it scans all folders. Folder headings are printed only when that folder has matching messages. The `Date` header includes date, time, and timezone when the message provides them.
- `--date <range>`, `-d <range>`: filter `--list` rows by message `Date` header. Use `YYYYMMDD` for that date or later, `YYYYMMDD-YYYYMMDD` for an inclusive start and exclusive end, `YYYYMMDD-` for an open end, or `-YYYYMMDD` for everything before that date.
- `--output <path>`, `-o <path>`: save all folders and messages under a local directory.

Backup mode creates a local directory tree matching the IMAP folder hierarchy and writes messages as `.eml` files named by UID. Message bodies are streamed directly from IMAP to the destination `.eml` file, without staging full messages in a temporary local file. Each folder also gets a `.imap-folder.json` metadata file. Re-running the backup skips existing UID files.

IMAP command failures are printed as `ERROR` rows in normal output so redirected logs show connection, authentication, folder, and message fetch failures. Backup summary rows always show the folder and message count, and only include `saved`, `skipped`, or `errors` fields when they add useful information. A backup stops at the first failed folder/message so the log does not look complete after an interrupted or refused IMAP operation; rerun the same backup command to resume skipped files.

Report output hides noisy structural attributes such as `\HasChildren`, `\HasNoChildren`, and `\UnMarked`. Rows with no meaningful attributes leave the attribute column blank. Subscription markers are shown only when the server reports at least one subscribed folder.

Folder names are decoded from IMAP modified UTF-7 for display and local paths, so IMAP's literal ampersand escape `&-` is shown as `&`.

When `--counts` is used, `--folders` is redundant and the tool prints only the count report.

If `config.cfg` exists in the current directory, it supplies defaults. CLI arguments override config values, and `IMAPSAVE_USER` / `IMAPSAVE_PASSWORD` override config credentials. The file uses JSON syntax despite the `.cfg` extension.

Example `config.cfg`:

```json
{
  "host": "mail.example.com",
  "connectHost": "192.0.2.10",
  "port": 993,
  "user": "user@example.com",
  "password": "secret",
  "counts": true
}
```
