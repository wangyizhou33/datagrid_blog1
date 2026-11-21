# 从物理传感器到标准化视觉观测

这是已生成的静态站点。站点入口、文章、公式、媒体和两个 3D Demo 都在本仓库内。部署无需安装依赖或运行构建。

## 本地预览

在仓库根目录运行：

```sh
python3 -m http.server 8000
```

访问 `http://127.0.0.1:8000/`。在文章的「Rig Visualization」和「地图定位」两节可以直接操作内嵌的 Demo。交互场景需要支持 WebGL 的浏览器。

## 部署到 GitHub Pages

1. 将本目录的内容提交到 GitHub 仓库根目录，包含隐藏的 `.github` 目录。
2. 打开仓库的 **Settings → Pages**，将 **Build and deployment → Source** 设为 **GitHub Actions**。
3. 推送默认分支，或从 **Actions → Deploy to GitHub Pages** 选择默认分支手动运行。运行成功后，部署任务会显示站点链接。

页面、素材和 Demo 使用相对路径，支持 `https://<owner>.github.io/<repo>/` 形式的地址。全景视频已转为约 19 MiB 的 H.264 MP4。

## 文件

- `index.html` 是可直接编辑的文章，公式已写成 MathML。
- `styles.css` 和 `site.js` 分别负责版式与目录与阅读进度。
- `assets/` 保存文章引用的图片、视频和资料。
- `demos/` 保存两个 Demo 和各自的本地运行文件。
- `.github/workflows/pages.yml` 发布静态文件。
