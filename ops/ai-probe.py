"""Checks authenticated pricing as well as liveness; never prints service tokens."""
import json
import os
import urllib.request

health = json.load(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=8))
assert health['status'] == 'ok'
if os.environ.get('AI_REQUIRE_TRAINED', 'true') == 'true':
    assert health['qualityModel'] == 'trained', 'Trained checkpoint required'
    assert health['photoCheck'] == 'enabled', 'Photo reference required'
request = urllib.request.Request('http://127.0.0.1:8000/predict/price',
    data=json.dumps({'productName': 'mango', 'category': 'fruits', 'unit': 'kg'}).encode(),
    headers={'Content-Type': 'application/json', 'X-Internal-Token': os.environ['AI_SERVICE_TOKEN']})
price = json.load(urllib.request.urlopen(request, timeout=8))
assert price['method'] == 'official_wholesale'
assert price['currency'] == 'PKR'
assert price['unit'] == 'kg'
assert price['marketCount'] >= 1
for field in ('commodity', 'observedOn', 'marketScope', 'source', 'sourceUrl', 'modelVersion'):
    assert price[field], f'Missing wholesale provenance: {field}'
from datetime import date
assert date.fromisoformat(price['observedOn']) <= date.today()
assert price['sourceUrl'].startswith('https://')
assert price['predictedMaxPrice'] >= price['predictedMinPrice'] > 0
print(json.dumps({'status': 'ok', 'qualityModel': health['qualityModel'], 'priceMethod': price['method']}))
