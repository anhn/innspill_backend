#!/usr/bin/env python3
"""Merge all suite result JSONs into one system-test table (CSV + JSON) and print a summary."""
import json, glob, csv, collections, os
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results')
AREA = {'BE-AUTH': 'Backend · Auth', 'BE-AI': 'Backend · AI features', 'BE-COURSES': 'Backend · Courses & docs',
        'BE-ASSESS': 'Backend · Assessment setup', 'BE-SUBMIT': 'Backend · Submissions & feedback', 'BE-COLLAB': 'Backend · Groups & collaboration',
        'BE-MON': 'Backend · Monitoring & metrics', 'BE-SEC': 'Security (cross-cutting)', 'BE-RATE': 'Security · Rate limiting',
        'BE-ROB': 'Robustness', 'BE-DBOUT': 'Robustness', 'FE-CORE': 'Frontend · Core', 'FE-FLOWS': 'Frontend · Workflows', 'FE-XSS': 'Security · Frontend'}
rows = []
for f in sorted(glob.glob(f'{R}/suites/*.json')):
    for r in json.load(open(f)):
        r['area'] = AREA.get(r.get('suite'), r.get('suite'))
        if r.get('status') == 'PASS': r['severity'] = ''
        elif r.get('id') == 'AUTH-19': r['severity'] = 'Medium'
        rows.append(r)
# stress results as rows
sp = f'{R}/stress.json'
if os.path.exists(sp):
    st = json.load(open(sp)); sc = st['scenarios'] if isinstance(st, dict) else st
    for s in sc:
        rows.append({'suite': 'STRESS', 'area': 'Performance & stress', 'id': s['id'], 'title': s['title'], 'type': 'stress',
                     'requirement': f"p97.5 ≤ {s['slo']['p97_5']} ms and error rate ≤ {s['slo']['maxErrorPct']}%",
                     'steps': f"autocannon {s['connections']} connections × {s['duration_s']} s", 'expected': f"p97.5 ≤ {s['slo']['p97_5']} ms, errors ≤ {s['slo']['maxErrorPct']}%",
                     'actual': f"{s['rps']} req/s; p50 {s['p50']} ms, p97.5 {s['p97_5']} ms, p99 {s['p99']} ms, max {s['max']} ms; errors {s['errorRate']}% {s['codes']}; RSS {s['rssBeforeMB']}→{s['rssAfterMB']} MB",
                     'status': s['status'], 'severity': '' if s['status'] == 'PASS' else 'Medium'})
cols = ['id', 'area', 'type', 'title', 'requirement', 'steps', 'expected', 'actual', 'status', 'severity', 'evidence']
with open(f'{R}/system_test_table.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=cols, extrasaction='ignore'); w.writeheader(); [w.writerow({k: r.get(k, '') for k in cols}) for r in rows]
json.dump(rows, open(f'{R}/system_test_table.json', 'w'), indent=1, ensure_ascii=False)
tot = collections.Counter(r['status'] for r in rows)
print('TOTAL', len(rows), dict(tot))
by = collections.defaultdict(collections.Counter)
for r in rows: by[r['area']][r['status']] += 1
for a, c in by.items(): print(f'  {a:38} {dict(c)}')
print('by type', {k: dict(v) for k, v in collections.Counter((r.get('type', ''), r['status']) for r in rows).items()} if False else collections.Counter((r.get('type') or 'functional', r['status']) for r in rows))
print('severity of failures', collections.Counter(r.get('severity') or '?' for r in rows if r['status'] != 'PASS'))
