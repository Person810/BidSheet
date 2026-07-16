// Client-side token (public by design): Paddle dashboard → Developer
// tools → Authentication → Client-side tokens. test_… = sandbox,
// live_… = production; the environment is derived from the prefix, so
// going live is a one-line swap.
var PADDLE_CLIENT_TOKEN = 'test_177c96a1c8d1992fb9a4ebef5b0';

var statusEl = document.getElementById('status');
var txn = new URLSearchParams(location.search).get('_ptxn');

if (PADDLE_CLIENT_TOKEN.indexOf('__') === 0) {
  statusEl.textContent = 'Checkout is not configured yet.';
} else if (!txn) {
  statusEl.innerHTML = 'Nothing to check out. Start from the BidSheet app: ' +
    'Settings → Cloud Sync → Subscribe. <a href="/">Back to bidsheet.co</a>';
} else {
  if (PADDLE_CLIENT_TOKEN.indexOf('test_') === 0) {
    Paddle.Environment.set('sandbox');
  }
  // Paddle.js spots the _ptxn parameter and opens the overlay checkout
  // for that transaction on its own once initialized.
  Paddle.Initialize({
    token: PADDLE_CLIENT_TOKEN,
    eventCallback: function (ev) {
      if (ev.name === 'checkout.completed') {
        statusEl.textContent = 'Payment complete. You can close this tab and return to BidSheet.';
      }
    }
  });
  statusEl.textContent = 'Opening secure checkout…';
}
