# Argent_Data.xlsx - text snapshot

Tab-separated dumps of every sheet in [../Argent_Data.xlsx](../Argent_Data.xlsx), generated so the data is greppable from the CLI. Re-run `extract.py` after the xlsx is updated.

## Sheets

| Sheet | File | Rows | Columns |
|---|---|---:|---|
| Info | `info.tsv` | 1 | This spreadsheet contains a reference for all the text in Argent as a reference. |
| Bell Tower Offerings | `bell-tower-offerings.tsv` | 22 | Name, Expansion, Players, Effect |
| Candidates | `candidates.tsv` | 14 | Name, Expansion, Title, Department, Side, Spell Name, Spell Cost, Spell Timing, Spell Effect |
| Consortium Voters | `consortium-voters.tsv` | 21 | Name, Expansion, Title, Vote, Description, Required |
| Mage Powers | `mage-powers.tsv` | 12 | Department, Expansion, Side, Timing, Effect |
| Rooms | `rooms.tsv` | 30 | Name, Expansion, Side, Merit Slots, Regular Slots, Merit Last, Special Effect, Slot 1, Slot 2, Slot 3, Slot 4, Slot 5... |
| Spells | `spells.tsv` | 42 | Book Name, Expansion, Department, Legendary, Level 1 Name, Level 1 Cost, Level 1 Timing, Level 1 Effect, Level 2 Name... |
| Supporters | `supporters.tsv` | 74 | Name, Expansion, Title, Department, Department 2, Timing, Effect |
| Vault Cards | `vault-cards.tsv` | 62 | Name, Expansion, Cost, Type, Timing, Effect, Copies |
| Archmage's Staff | `archmage-s-staff.tsv` | 2 | Name, Expansion, Side, Space Effect, Action Type, Action |
| Scenarios | `scenarios.tsv` | 0 | (empty) |
| Masks | `masks.tsv` | 0 | (empty) |

## How to use

- `grep -i Adventuring rooms.tsv` - find a row by name
- `cut -f1,3,7 rooms.tsv` - pull specific columns by 1-based index
- Column order matches the first row of each TSV.

## Regenerate

```bash
python3 docs/argent_data/extract.py
```
