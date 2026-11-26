# Our Days 相册

公开相册由 GitHub Pages 发布。 [打开相册](https://gdutsen-jpg.github.io/)

| 路径 | 内容 |
| --- | --- |
| `index.html` | 页面结构 |
| `assets/styles/`、`assets/scripts/` | 样式和浏览器代码 |
| `assets/art/`、`assets/fonts/` | 插画和字体 |
| `data/album.json` | 相册设置、回忆和照片路径 |
| `assets/photos/` | 相册备份中的照片文件 |

## 预览

在仓库目录运行下方命令，再用浏览器打开本地页面。 [打开预览](http://127.0.0.1:8000/)

```sh
python -m http.server 8000 --bind 127.0.0.1
```

## 更新发布快照

1. 在相册里点 **Save & backup → Export full backup**，保存 JSON 备份。
2. 在仓库目录运行下方命令，把备份转成独立的记录文件和照片。
3. 查看 `data/album.json` 和 `assets/photos/` 的改动，提交并推送到 `main`。GitHub Pages 会发布这次快照，Git 提交历史可用于查看和恢复旧版本。

```sh
node tools/import-backup.cjs "path/to/full-backup.json"
```

浏览器里的新增记录和修改只保存在当前浏览器。导出完整备份并发布后，其他访客才能看到对应的快照。
