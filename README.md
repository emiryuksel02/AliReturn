<p align='center'>
  <img src='extension/icons/icon-512.png' width='112' alt='AliReturn icon'>
</p>

<h1 align='center'>AliReturn</h1>

<p align='center'>
  A Chrome extension that exports the actual refund amounts from your AliExpress returns for a selected date range.
</p>

## Features

- Filters returns by an exact, inclusive date range.
- Reads the real refunded amount from each return's detail page.
- Navigates through every returns page automatically.
- Works independently of the AliExpress display language.
- Exports Excel-friendly CSV and JSON files.
- Records returns whose refund amount cannot be found.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository's `extension` folder.

## Use

1. Open the AliExpress **Returns & refunds** page.
2. Select the return status you want to export.
3. Open AliReturn, choose the From and To dates, and click **Collect returns**.
4. Keep the returns tab open while AliReturn processes the list.
5. Open AliReturn again when collection finishes, then download the CSV or JSON file.

## Notes

- Close Chrome DevTools on the AliExpress tab while collection is running.
- Chrome may display a debugger-permission warning. AliReturn uses this permission only to click each detail button and disconnects immediately afterward.
- If no refund amount appears within five seconds, the return is exported as **Missing amount** and collection continues.
- CSV exports use semicolon-separated columns and decimal commas for compatibility with European Excel installations.

## Privacy

AliReturn runs locally in Chrome. Exported return data stays in your browser and is not sent to an external service.

## License

Licensed under the [MIT License](LICENSE).
