# The log and the defences

*Planned.*

## Everything is logged

Every request and response, in full, every action the agent takes with its input and result, every grant you change and
every approval you give is logged in your browser. You can read the log in the app and export it as a file. Nothing is
sent anywhere else.

## Defences, on by default

- **No remote content in the chat:** images and links in the model's answer are never loaded on their own; links show
  as text for you to open.
- **Data is marked as data:** rows and file contents sent to the model are labelled as data, never as instructions.
- **Tokens shown:** the tokens each request and each session use. Spending limits are your gateway's to set.
- **A stop button** halts the agent mid-task and cancels what it hasn't done yet.
