#!/bin/bash
# Start server in background
node ./dist/Nizam/server/main.server.mjs &
SERVER_PID=$!
echo "Server started with PID $SERVER_PID"
sleep 5

# Test health endpoint
echo "Testing health endpoint:"
curl -s http://localhost:4000/health
echo "\n"

# Test COD order creation
echo "Testing COD order creation:"
RESPONSE=$(curl -s -X POST http://localhost:4000/api/create-cod-order \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","address":"123 Test St","items":[{"id":1,"name":"Test Product","price":50,"quantity":2}],"total":100,"currency":"USD"}')
echo "$RESPONSE"

# Extract order reference
ORDER_REF=$(echo "$RESPONSE" | grep -o '"orderReference":"[^"]*"' | cut -d'"' -f4)
echo "Order Reference: $ORDER_REF"

if [ -n "$ORDER_REF" ]; then
  # Test get single order
echo "\nTesting get single order:"
  curl -s http://localhost:4000/api/orders/$ORDER_REF
echo "\n"
  
  # Test get all orders
echo "Testing get all orders:"
  curl -s http://localhost:4000/api/orders?limit=5
echo "\n"
  
  # Test update status
echo "Testing update order status:"
  curl -s -X PATCH http://localhost:4000/api/orders/$ORDER_REF/status \
    -H "Content-Type: application/json" \
    -d '{"status":"confirmed"}'
echo "\n"
fi

# Stop server
kill $SERVER_PID 2>/dev/null
echo "\nTest completed."
