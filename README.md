# Our Days 相册

相册由 GitHub Pages 发布。 [打开相册](https://gdutsen-jpg.github.io/)

| 路径 | 内容 |
| --- | --- |
| `index.html` | 页面结构 |
| `data/album.json` | 相册设置、纪念日期、回忆和照片路径 |
| `data/site-content.js` | 周末活动与到访地区 |
| `assets/photos/` | 已发布的相册照片 |
| `assets/maps/` | 地图形状、地区 ID 和底图来源 |
| `assets/styles/`、`assets/scripts/` | 样式和浏览器代码 |

## 更新相册

直接编辑数据文件，提交并推送到 `main`。GitHub Pages 会发布该版本，来访者看到同一份相册。

- 日期和回忆在 `data/album.json` 中维护。可用 `node tools/import-backup.cjs "path/to/full-backup.json"` 将完整版回忆备份转换为记录文件和独立照片。
- 周末活动在 `data/site-content.js` 的 `activities` 里维护。到访地区的 ID 分别填入 `visited.world` 或 `visited.china`，对应 ID 可在地图数据中查到。

## 保存记录

网页上的 **Save & backup** 可以下载已发布的相册。以前在浏览器里添加过的留言、回忆、活动和足迹可通过 **Export browser records** 下载。请使用添加记录时的浏览器和同一个访问地址。

## 预览

在仓库目录运行下方命令，再打开 [预览页面](http://127.0.0.1:8000/)。

```sh
python -m http.server 8000 --bind 127.0.0.1
```
