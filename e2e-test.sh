#!/bin/bash
set -e
API="http://localhost:3001/api"

echo "=== STEP 1: Login all users ==="
BUYER_TOKEN=$(curl -s $API/auth/login -H "Content-Type: application/json" -d '{"email":"buyer@acme.co.uk","password":"password123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
SUPPLIER_TOKEN=$(curl -s $API/auth/login -H "Content-Type: application/json" -d '{"email":"supplier@swiftlogistics.co.uk","password":"password123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
LP_TOKEN=$(curl -s $API/auth/login -H "Content-Type: application/json" -d '{"email":"lp@capitalbridge.co.uk","password":"password123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
ADMIN_TOKEN=$(curl -s $API/auth/login -H "Content-Type: application/json" -d '{"email":"admin@platform.co.uk","password":"password123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
echo "✅ All tokens acquired"

echo ""
echo "=== STEP 2: Get initial balances ==="
echo -n "Buyer balance:    "
curl -s $API/users/balance -H "Authorization: Bearer $BUYER_TOKEN" | python3 -c "import sys,json; b=json.load(sys.stdin)['balance']; print(f'£{b/100:,.2f}')"
echo -n "Supplier balance: "
curl -s $API/users/balance -H "Authorization: Bearer $SUPPLIER_TOKEN" | python3 -c "import sys,json; b=json.load(sys.stdin)['balance']; print(f'£{b/100:,.2f}')"
echo -n "LP balance:       "
curl -s $API/users/balance -H "Authorization: Bearer $LP_TOKEN" | python3 -c "import sys,json; b=json.load(sys.stdin)['balance']; print(f'£{b/100:,.2f}')"

echo ""
echo "=== STEP 3: Get supplier ID ==="
SUPPLIER_ID=$(curl -s "$API/users?role=SUPPLIER" -H "Authorization: Bearer $BUYER_TOKEN" | python3 -c "import sys,json; users=json.load(sys.stdin); print(next(u['id'] for u in users if 'Swift' in u.get('companyName','')))")
echo "Supplier (Swift Logistics): $SUPPLIER_ID"

echo ""
echo "=== STEP 4: Buyer creates a PO ==="
PO_RESULT=$(curl -s -X POST $API/purchase-orders \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"supplierId\":\"$SUPPLIER_ID\",\"description\":\"E2E Demo: Industrial Widgets\",\"lineItems\":[{\"description\":\"Widget A (Premium)\",\"quantity\":200,\"unitPricePennies\":7500},{\"description\":\"Widget B (Standard)\",\"quantity\":500,\"unitPricePennies\":3000}]}")
PO_ID=$(echo $PO_RESULT | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
PO_REF=$(echo $PO_RESULT | python3 -c "import sys,json; print(json.load(sys.stdin)['reference'])")
PO_TOTAL=$(echo $PO_RESULT | python3 -c "import sys,json; t=json.load(sys.stdin)['totalAmountPennies']; print(f'£{t/100:,.2f}')")
echo "✅ PO created: $PO_REF ($PO_TOTAL)"
echo "   200 × £75 + 500 × £30 = $PO_TOTAL"
echo "   Status: DRAFT"

echo ""
echo "=== STEP 5: Buyer sends PO to supplier ==="
curl -s -X PATCH $API/purchase-orders/$PO_ID/send -H "Authorization: Bearer $BUYER_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'✅ Status: {d[\"status\"]}')"

echo ""
echo "=== STEP 6: Supplier accepts PO (locks buyer funds) ==="
curl -s -X PATCH $API/purchase-orders/$PO_ID/accept -H "Authorization: Bearer $SUPPLIER_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'✅ Status: {d[\"status\"]}'); print(f'   Payment Lock: {d.get(\"paymentLock\",{}).get(\"status\",\"N/A\")} — £{d.get(\"paymentLock\",{}).get(\"amountPennies\",0)/100:,.2f}')"

echo ""
echo "=== STEP 7: Check buyer balance (should be reduced) ==="
echo -n "Buyer balance:    "
curl -s $API/users/balance -H "Authorization: Bearer $BUYER_TOKEN" | python3 -c "import sys,json; b=json.load(sys.stdin)['balance']; print(f'£{b/100:,.2f}')"

echo ""
echo "=== STEP 8: Check payment locks ==="
curl -s $API/payment-locks -H "Authorization: Bearer $BUYER_TOKEN" | python3 -c "
import sys,json
locks = json.load(sys.stdin)
for l in locks:
    print(f'   Lock: {l[\"purchaseOrder\"][\"reference\"]} — {l[\"status\"]} — £{l[\"amountPennies\"]/100:,.2f}')
print(f'✅ {len(locks)} payment lock(s) found')
"

echo ""
echo "=== STEP 9: Supplier requests early payment ==="
EP_RESULT=$(curl -s -X POST $API/early-payments \
  -H "Authorization: Bearer $SUPPLIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"purchaseOrderId\":\"$PO_ID\"}")
EP_ID=$(echo $EP_RESULT | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo $EP_RESULT | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'✅ Early payment requested')
print(f'   Face value:  £{d[\"faceValuePennies\"]/100:,.2f}')
print(f'   Service fee: £{d[\"serviceFeePennies\"]/100:,.2f} (2.5%)')
print(f'   Net advance: £{d[\"netAdvancePennies\"]/100:,.2f}')
print(f'   Status: {d[\"status\"]}')
"

echo ""
echo "=== STEP 10: LP browses marketplace ==="
curl -s $API/early-payments/marketplace -H "Authorization: Bearer $LP_TOKEN" | python3 -c "
import sys,json
items = json.load(sys.stdin)
for i in items:
    print(f'   {i[\"purchaseOrder\"][\"reference\"]} — Face: £{i[\"faceValuePennies\"]/100:,.2f} — Fee: £{i[\"serviceFeePennies\"]/100:,.2f} — Advance: £{i[\"netAdvancePennies\"]/100:,.2f}')
print(f'✅ {len(items)} request(s) in marketplace')
"

echo ""
echo "=== STEP 11: LP funds the early payment ==="
curl -s -X PATCH $API/early-payments/$EP_ID/fund -H "Authorization: Bearer $LP_TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'✅ Early payment FUNDED')
print(f'   Status: {d[\"status\"]}')
"

echo ""
echo "=== STEP 12: Check balances after LP funding ==="
echo -n "Supplier balance: "
curl -s $API/users/balance -H "Authorization: Bearer $SUPPLIER_TOKEN" | python3 -c "import sys,json; b=json.load(sys.stdin)['balance']; print(f'£{b/100:,.2f} (should have increased by net advance)')"
echo -n "LP balance:       "
curl -s $API/users/balance -H "Authorization: Bearer $LP_TOKEN" | python3 -c "import sys,json; b=json.load(sys.stdin)['balance']; print(f'£{b/100:,.2f} (should have decreased by net advance)')"

echo ""
echo "=== STEP 13: Supplier marks delivery ==="
curl -s -X PATCH $API/purchase-orders/$PO_ID/deliver -H "Authorization: Bearer $SUPPLIER_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'✅ Status: {d[\"status\"]}')"

echo ""
echo "=== STEP 14: Buyer verifies delivery (settles to LP) ==="
curl -s -X PATCH $API/purchase-orders/$PO_ID/verify -H "Authorization: Bearer $BUYER_TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'✅ Status: {d[\"status\"]}')
print(f'   Payment Lock: {d.get(\"paymentLock\",{}).get(\"status\",\"RELEASED\")}')
"

echo ""
echo "=== STEP 15: Final balances ==="
echo -n "Buyer balance:    "
curl -s $API/users/balance -H "Authorization: Bearer $BUYER_TOKEN" | python3 -c "import sys,json; b=json.load(sys.stdin)['balance']; print(f'£{b/100:,.2f}')"
echo -n "Supplier balance: "
curl -s $API/users/balance -H "Authorization: Bearer $SUPPLIER_TOKEN" | python3 -c "import sys,json; b=json.load(sys.stdin)['balance']; print(f'£{b/100:,.2f}')"
echo -n "LP balance:       "
curl -s $API/users/balance -H "Authorization: Bearer $LP_TOKEN" | python3 -c "import sys,json; b=json.load(sys.stdin)['balance']; print(f'£{b/100:,.2f}')"

echo ""
echo "=== STEP 16: Verify ledger integrity ==="
curl -s "$API/ledger/verify/$PO_ID" -H "Authorization: Bearer $BUYER_TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'✅ Ledger chain valid: {d[\"valid\"]}')
print(f'   Events in chain: {d.get(\"eventCount\",\"N/A\")}')
print(f'   Details: {d[\"details\"]}')
"

echo ""
echo "=== STEP 17: Admin stats ==="
curl -s $API/admin/stats -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'✅ Admin Dashboard Stats:')
print(f'   Total POs:       {d[\"totalPOs\"]}')
print(f'   Settled POs:     {d[\"settledPOs\"]}')
print(f'   Total Volume:    £{d[\"totalVolumePennies\"]/100:,.2f}')
print(f'   Active Locks:    {d[\"activeLocks\"]}')
print(f'   Early Payments:  {d[\"earlyPayments\"]}')
print(f'   Total Fees:      £{d[\"totalFeesPennies\"]/100:,.2f}')
print(f'   Total Users:     {d[\"totalUsers\"]}')
"

echo ""
echo "=== STEP 18: Frontend page check ==="
for page in login dashboard dashboard/purchase-orders dashboard/early-payments dashboard/payment-locks dashboard/ledger dashboard/admin; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/$page)
  if [ "$STATUS" = "200" ]; then
    echo "✅ /$page → $STATUS"
  else
    echo "❌ /$page → $STATUS"
  fi
done

echo ""
echo "=============================="
echo "🎉 FULL E2E DEMO COMPLETE"
echo "=============================="
