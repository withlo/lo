# Images from anywhere

![remote](https://evil.example/track.png)

![http](http://camo.githubusercontent.com/a)

![data png](data:image/png;base64,iVBORw0KGgo=)

![data svg](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)

![data svg case](DATA:IMAGE/SVG+XML,<svg onload=alert(1)>)

![blob](blob:https://github.com/x)

![file](file:///etc/passwd)

![relative](./a.png)

![by reference][img]

[img]: https://evil.example/ref.png

![lookalike](https://camo.githubusercontent.com.evil.example/a)

![subdomain](https://x.camo.githubusercontent.com/a)

![trailing dot](https://camo.githubusercontent.com./a)

![port](https://camo.githubusercontent.com:8443/a)

![user](https://u:p@camo.githubusercontent.com/a)

![dots](https://github.com/user-attachments/assets/../../evil/x)

![encoded dots](https://github.com/user-attachments/assets/%2e%2e/%2e%2e/evil/x)

![raw](https://raw.githubusercontent.com/evil/r/main/x.png)

![avatar](https://avatars.githubusercontent.com/u/1)

![repo file](https://github.com/evil/r/raw/main/x.png)

<img src="https://evil.example/html.png">

<img src="https://camo.githubusercontent.com/a" data-canonical-src="https://evil.example/claimed.png">

<picture><source srcset="https://evil.example/a.png"><img src="https://camo.githubusercontent.com/a"></picture>

<video src="https://evil.example/v.mp4" poster="https://evil.example/p.png"></video>

[![nested](https://evil.example/n.png)](https://example.com)

![![double](https://evil.example/d.png)](https://evil.example/o.png)

![](https://evil.example/no-alt.png)

![](data:image/png;base64,AAAA)

Kept: ![camo](https://camo.githubusercontent.com/abc/68747470733a2f2f652e636f6d2f612e706e67) ![attachment](https://github.com/user-attachments/assets/cbe34088-7125-49ac-b6ed-ce17762af48a)
