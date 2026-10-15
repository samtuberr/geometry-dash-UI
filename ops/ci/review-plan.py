#!/usr/bin/env python3
"""Summarize actual Terraform changes and block destructive routine applies."""
import json
import sys

plan = json.load(open(sys.argv[1]))
unsafe = []
print('| Resource | Planned action |\n| --- | --- |')
for item in plan.get('resource_changes', []):
    actions = item['change']['actions']
    if actions == ['no-op']:
        continue
    print(f"| `{item['address']}` | {', '.join(actions)} |")
    if 'delete' in actions:
        unsafe.append(item['address'])
if unsafe:
    sys.exit('Deletion/replacement requires the documented local maintenance procedure: ' + ', '.join(unsafe))
print('\nReview machine type, disk size, public IPv4 and Monitoring changes against the GCP calculator before applying.')
