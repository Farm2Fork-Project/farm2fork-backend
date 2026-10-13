"""Checks authenticated pricing as well as liveness; never prints service tokens."""
import json
import os
import urllib.request

health = json.load(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=8))
assert health['status'] == 'ok'
if os.environ.get('AI_REQUIRE_TRAINED', 'false') == 'true':
    assert health['qualityModel'] == 'trained', 'Trained checkpoint required'
request = urllib.request.Request('http://127.0.0.1:8000/predict/price',
    data=json.dumps({'productName': 'mango', 'category': 'fruits', 'unit': 'kg'}).encode(),
    headers={'Content-Type': 'application/json', 'X-Internal-Token': os.environ['AI_SERVICE_TOKEN']})
price = json.load(urllib.request.urlopen(request, timeout=8))
assert price['currency'] == 'PKR'
assert price['predictedMaxPrice'] >= price['predictedMinPrice'] > 0
print(json.dumps({'status': 'ok', 'qualityModel': health['qualityModel'], 'priceMethod': price['method']}))
