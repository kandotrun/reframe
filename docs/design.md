# Reframe interface design

The working surface is a decision map: a revised source is visibly connected to the decisions it supports and to the people who must recheck them. The user enters an already meaningful case, rather than a landing page or an empty chatbot.

## Tokens

- Paper `#f5f8fc`: a cool, quiet work surface.
- Ink `#192b45`: headings, reading text, and structural navigation.
- Cobalt `#245bec`: the selected case, an active source, and the primary action.
- Review amber `#ae6811`: a changed premise that needs a person to review it.
- Verified green `#217568`: a completed check or a confirmed decision.
- Rule `#dae3ee`: divisions and edges between information.

Japanese typography uses the macOS Hiragino system family with Noto Sans JP and Yu Gothic fallbacks. Latin labels and measured values use the same system family to avoid making ordinary work look like a terminal. The brand is slightly condensed through spacing. Type sizes are 11, 12, 13, 14, 16, 20, 26, and 32 px. Dense metadata remains at least 11 px.

## Layout

A narrow ink navigation rail and a light case queue frame the working document. The case header establishes the order and the change. A spatial map takes the largest area; the right evidence panel provides the selected source or review task. Tabs expose the full differences, decisions and handoff, and the model evaluation lab. Content is left aligned. The evaluation lab is deliberately a secondary surface.

```
rail | case queue | case title                           primary action
     |            | tabs
     |            | source → decisions → people | selected evidence
     |            | history / replay            | action
```

The map is the one expressive element. It uses directed curves, labeled columns, and small paper-like nodes rather than generic KPI cards. Color is tied to real domain state; dotted links are suggestions and solid links are explicit references. Approval remains gated by actual confirmations. No fabricated metrics, AI confidence, or ticking demo activity is displayed.

## Review against the brief

A large marketing hero would delay the useful interaction, so the opening is the fictional order itself. A generic dashboard grid would obscure the dependency, so the main surface uses one graph and a contextual document. Technical model controls are grouped with evidence search and the evaluation lab. No scrolling decoration or ambient animation competes with reading. On small screens the queue becomes a horizontal case selector and the map can be inspected in a scrollable surface; evidence remains immediately below it. All actions have visible focus and reduced motion is respected.
