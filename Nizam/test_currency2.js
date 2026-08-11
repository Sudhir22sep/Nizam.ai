const exchangeRates = { USD: 1, INR: 95.21, AED: 3.67, SAR: 3.73 };

// ACTUAL FLOW: Cart total is in USD, frontend converts to selected currency
// Product price = $15 (from products.json)
// Cart total = $15 (USD)
// User currency = INR (default)

// Frontend converts USD -> INR for display AND for sending to backend
const cartTotalUsd = 15;
const selectedCurrency = 'INR';  // default
const frontendRate = exchangeRates[selectedCurrency];
const totalInSelectedCurrency = cartTotalUsd * frontendRate;  // This is what frontend sends!

console.log('=== ACTUAL FLOW: Cart $15 USD, Currency INR ===');
console.log('Cart total (USD): $' + cartTotalUsd);
console.log('Frontend converts: $' + cartTotalUsd + ' × ' + frontendRate + ' = ₹' + totalInSelectedCurrency.toFixed(2));
console.log('Frontend sends to backend: total=' + totalInSelectedCurrency.toFixed(2) + ', currency=' + selectedCurrency);

// Backend receives and converts back to INR for Razorpay
const backendFrontendCurrency = selectedCurrency;
const backendFrontendRate = exchangeRates[backendFrontendCurrency];
const inrRate = exchangeRates['INR'];
const totalInUsd = totalInSelectedCurrency / backendFrontendRate;
const totalInInr = totalInUsd * inrRate;
const amountInPaise = Math.round(totalInInr * 100);

console.log('Backend converts: ' + totalInSelectedCurrency.toFixed(2) + ' ÷ ' + backendFrontendRate + ' = $' + totalInUsd.toFixed(2));
console.log('Backend converts: $' + totalInUsd.toFixed(2) + ' × ' + inrRate + ' = ₹' + totalInInr.toFixed(2));
console.log('Razorpay receives: ₹' + (amountInPaise/100).toFixed(2) + ' (' + amountInPaise + ' paise)');
console.log('');

// Now test with USD currency selected
console.log('=== ACTUAL FLOW: Cart $15 USD, Currency USD ===');
const selectedCurrency2 = 'USD';
const frontendRate2 = exchangeRates[selectedCurrency2];
const totalInSelectedCurrency2 = cartTotalUsd * frontendRate2;
console.log('Cart total (USD): $' + cartTotalUsd);
console.log('Frontend converts: $' + cartTotalUsd + ' × ' + frontendRate2 + ' = $' + totalInSelectedCurrency2.toFixed(2));
console.log('Frontend sends to backend: total=' + totalInSelectedCurrency2.toFixed(2) + ', currency=' + selectedCurrency2);

const backendFrontendCurrency2 = selectedCurrency2;
const backendFrontendRate2 = exchangeRates[backendFrontendCurrency2];
const totalInUsd2 = totalInSelectedCurrency2 / backendFrontendRate2;
const totalInInr2 = totalInUsd2 * inrRate;
const amountInPaise2 = Math.round(totalInInr2 * 100);

console.log('Backend converts: ' + totalInSelectedCurrency2.toFixed(2) + ' ÷ ' + backendFrontendRate2 + ' = $' + totalInUsd2.toFixed(2));
console.log('Backend converts: $' + totalInUsd2.toFixed(2) + ' × ' + inrRate + ' = ₹' + totalInInr2.toFixed(2));
console.log('Razorpay receives: ₹' + (amountInPaise2/100).toFixed(2) + ' (' + amountInPaise2 + ' paise)');