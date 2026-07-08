# MCP Apps with Tejas

Round of intros

Going to websites they choose the UX - cookie banners, auto-coursal - the web is hostile to user experiences

adidas.com as an example - just google spam filters, popups

user inyerface

compare to "chatgpt" - "whats the schedule for web summer camp 2026" - async, works on yoru behalf, nice clean table

but companies lose the brands

IBM have a new coding agent BOB - download and use if you like - has routing models for opus 4.8 - Bob is a fork of VSCode - running on IBM cloud

1030

IBM seems corporate difficulty Tejas complains about them

Hes giving out an open router key for folks via slack channels

people just vibe coded a streaming chat app.  (no AGUI here)

mcp server vibe coded - stress mcp server is prerequisite

he writes out the mcp app live in VSCode

adds a tool for "greet" - "always start a conversation"

runs mcp in claude desktop

now locally uses automator and applescript to control the calendar

BREAK 1115

display within chatgpt.com mcp apps
workflow through buying websummit camp and includes buying

making connection via cloudflared and configuring in chatgpt apps (some people stuck on this bit)

hook up localhost mcp app

add a reosurce to local mcp app

openai has its own openai/outputTemplate

show html within chatgpt

CSP off in dev mode, forces CSP in production e.g. cant send external resources so you can request css have to inline all css


openai attaches tools and colour
right way to do mutations - emit event, chatgpt calls tool, sends results back

two kinds of tools - data tools and ui tools

you can @MCPApp in chatgpt to direct it

openai specific context

window.openai;
window.parent.postMessage()

it may be window.openai.mcp.

window.openai.sendFollowUpMessage() 

last few minutes on authenitcation and reference github

chatgpt supports authneitcaiton and expect oauth2 server not client (e.g. login with google does not work)

oauth2 sends a verifiation code goes through PEKS and senda. token and they send a hash.  Use a library IDP? OAuth0?

claude uses extensions and connectors instead no http externals - very fragmented

the combinatin of mcp apps is powerful - spotify, alltrails, booking.com 

marketplace for apps