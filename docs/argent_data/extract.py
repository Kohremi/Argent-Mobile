#!/usr/bin/env python3
"""Extract every sheet in ../Argent_Data.xlsx into TSV next to this script.

Pure-stdlib (xlsx is just a zip of XML, no openpyxl required). Run from
the repo root or this directory:

    python3 docs/argent_data/extract.py

Regenerates all *.tsv files and the README.md table. Safe to re-run.
"""

import os
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
import zipfile

NS = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL_NS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PKG_REL_NS = '{http://schemas.openxmlformats.org/package/2006/relationships}'


def cell_val(c, strings):
    t = c.get('t', 'n')
    v = c.find('x:v', NS)
    if v is None:
        is_ = c.find('x:is', NS)
        if is_ is not None:
            ts = is_.findall('x:t', NS)
            return ''.join((tn.text or '') for tn in ts)
        return ''
    if t == 's':
        return strings[int(v.text)]
    if t == 'b':
        return 'TRUE' if v.text == '1' else 'FALSE'
    return v.text or ''


def col_idx(ref):
    letters = ''.join(ch for ch in ref if ch.isalpha())
    i = 0
    for ch in letters:
        i = i * 26 + (ord(ch) - ord('A') + 1)
    return i - 1


def read_sheet(path, strings):
    root = ET.parse(path).getroot()
    rows_raw = []
    max_col = 0
    for row in root.find('x:sheetData', NS).findall('x:row', NS):
        cells = {}
        for c in row.findall('x:c', NS):
            idx = col_idx(c.get('r', 'A1'))
            cells[idx] = cell_val(c, strings)
            if idx > max_col:
                max_col = idx
        rows_raw.append(cells)
    return [
        [cells.get(i, '') for i in range(max_col + 1)]
        for cells in rows_raw
    ]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    xlsx_path = os.path.normpath(os.path.join(here, '..', 'Argent_Data.xlsx'))
    if not os.path.exists(xlsx_path):
        raise SystemExit(f'xlsx not found: {xlsx_path}')

    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(xlsx_path) as z:
            z.extractall(tmp)

        # Shared strings
        ss_root = ET.parse(os.path.join(tmp, 'xl/sharedStrings.xml')).getroot()
        strings = []
        for si in ss_root.findall('x:si', NS):
            parts = []
            for t in si.iter():
                if t.tag.endswith('}t'):
                    parts.append(t.text or '')
            strings.append(''.join(parts))

        # Workbook + relationships
        wb = ET.parse(os.path.join(tmp, 'xl/workbook.xml')).getroot()
        sheets = [
            {
                'name': s.get('name'),
                'rId': s.get(REL_NS + 'id'),
            }
            for s in wb.find('x:sheets', NS)
        ]
        rels = {
            r.get('Id'): r.get('Target')
            for r in ET.parse(
                os.path.join(tmp, 'xl/_rels/workbook.xml.rels')
            ).getroot().findall(PKG_REL_NS + 'Relationship')
        }

        slug_re = re.compile(r'[^a-z0-9]+')
        manifest = []
        for sheet in sheets:
            target = rels.get(sheet['rId'])
            if not target:
                continue
            target_path = os.path.join(tmp, 'xl', target.lstrip('/'))
            rows = read_sheet(target_path, strings)
            slug = slug_re.sub('-', sheet['name'].lower()).strip('-')
            tsv_path = os.path.join(here, f'{slug}.tsv')
            with open(tsv_path, 'w') as f:
                for row in rows:
                    cleaned = [
                        ('\\n'.join((c or '').split('\n'))).replace('\t', ' ')
                        for c in row
                    ]
                    f.write('\t'.join(cleaned) + '\n')
            header = rows[0] if rows else []
            manifest.append(
                (sheet['name'], slug + '.tsv', header, max(0, len(rows) - 1))
            )
            print(
                f'{sheet["name"]:30s} -> {slug}.tsv  '
                f'({len(rows)} rows, {len(header)} cols)'
            )

    # README
    readme_path = os.path.join(here, 'README.md')
    with open(readme_path, 'w') as f:
        f.write('# Argent_Data.xlsx - text snapshot\n\n')
        f.write(
            'Tab-separated dumps of every sheet in '
            '[../Argent_Data.xlsx](../Argent_Data.xlsx), generated so the '
            'data is greppable from the CLI. Re-run `extract.py` after the '
            'xlsx is updated.\n\n'
        )
        f.write('## Sheets\n\n')
        f.write('| Sheet | File | Rows | Columns |\n')
        f.write('|---|---|---:|---|\n')
        for name, fn, header, rowcount in manifest:
            cols = ', '.join(header) if header else '(empty)'
            if len(cols) > 120:
                cols = cols[:117] + '...'
            f.write(f'| {name} | `{fn}` | {rowcount} | {cols} |\n')
        f.write(
            '\n## How to use\n\n'
            '- `grep -i Adventuring rooms.tsv` - find a row by name\n'
            '- `cut -f1,3,7 rooms.tsv` - pull specific columns by 1-based '
            'index\n'
            '- Column order matches the first row of each TSV.\n\n'
            '## Regenerate\n\n'
            '```bash\npython3 docs/argent_data/extract.py\n```\n'
        )
    print(f'\nWrote README at {readme_path}')


if __name__ == '__main__':
    main()
