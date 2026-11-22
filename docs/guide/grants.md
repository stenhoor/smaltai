# Grants

*Planned.* You decide what the agent may see and do, per gateway and per database. Within its grants it acts without
asking each time; outside them, it asks.

## What it may see

One level per database:

| Level | The agent sees |
| --- | --- |
| Schema only | Table, column and type names, and the open document's outline |
| Schema and statistics | Also counts, distinct counts, minimum and maximum, and null rates; no rows |
| Schema and sample rows | Also a sample of the size you set, with query results capped to it |
| Full data | Query results and rows as needed |

You can exclude tables and columns from whatever level you grant. Excluded columns never leave the browser.

## What it may do, in smaltbi

- **Change the report:** measures, visuals, pages and filters, each change undoable.
- **Run queries:** what comes back to the model follows the data level.
- **Create views and materialized views.**
- **Change data:** off unless you enable it; not recommended in smaltbi.
- **Configuration tables** always need your explicit approval, whatever you have granted.

Grants are remembered in your browser and shown together in one panel, where you can revoke any of them.
