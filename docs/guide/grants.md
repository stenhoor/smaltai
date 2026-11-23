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

You can exclude tables and columns from whatever level you grant. Excluded columns never leave the browser. Samples
carry 100 rows unless you set another number.

When you grant sample rows or full data, smaltai shows you, as part of the grant, that rows will go to the gateway, and
that a local gateway may pass them on to a hosted model without smaltai being able to tell.

## What it may do, in smaltbi

- **Change the report:** measures, visuals, pages and filters, each change undoable.
- **Run queries:** what comes back to the model follows the data level.
- **Create views and materialized views.**
- **Change data:** off unless you enable it; not recommended in smaltbi.
- **Configuration tables** always need your explicit approval, whatever you have granted.
- **Code the agent writes** (a notebook cell, a TypeScript tab) never runs unless you granted that action or approve it.

When the agent asks, you can allow the action once or grant it from then on. An action that can't be undone says so
when it asks.

## What grants protect

Grants limit the agent: what the model sees, and what it does through the app's actions. The agent only reads them:
it has no way to change them, and an app's actions must not either. Only you change them.

They don't limit other code on the same page. Every smalt app and docs site shares one web origin
(`stenhoor.github.io`), so code that runs there, such as your own TypeScript tabs or notebook cells, can already read
your databases and reach any address directly, with or without grants.

Grants are remembered in your browser and shown together in one panel, where you can revoke any of them.
