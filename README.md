# 简贴

一个纯前端的 Markdown 剪贴板应用，笔记和图片全部存在你自己的 GitHub 仓库中，跨端同步，无需后端，开箱即用。

<p align="center">
  <img src="./image.png" width="720" alt="主页界面">
</p>

## 快速开始

### 1. Fork 本仓库

点击页面右上角的 **Fork** 按钮，将仓库复制到你的账号下。

### 2. 开启 GitHub Pages

1. 进入你 Fork 的仓库 -> **Settings** -> **Pages**
2. **Source** 选择 `Deploy from a branch`
3. **Branch** 选择 `main`，目录选择 `/ (root)`
4. 点击 **Save**，等待几分钟即可通过 `https://<用户名>.github.io/<仓库名>/` 访问

### 3. 创建 Personal Access Token

1. 访问 [GitHub Settings -> Personal access tokens](https://github.com/settings/tokens)
2. 点击 **Generate new token (classic)**
3. 填写备注，勾选 **repo** 权限（完整勾选 `repo` 下的所有子项）
4. 点击 **Generate token**，复制生成的 token（`ghp_` 开头）

> ⚠️ 如果你的 Fork 仓库是 **私有** 的，Token 必须勾选完整的 `repo` 权限（不是 `public_repo`），否则无法访问。

### 4. 配置同步

1. 打开你的简贴页面，点击右上角 ⚙️ 设置按钮
2. 在 **GitHub 同步** 区域：
   - 粘贴你的 **Personal Access Token**
   - 填写 **仓库名**（格式：`用户名/仓库名`，如 `Garonix/easytie`）
3. 点击 **测试连接** 验证配置
4. 点击 **保存设置**

配置完成后，你的笔记会自动同步到 Fork 仓库的 `data/notes.json`，图片存在 `data/images/` 目录下。

## 多端同步

在任何设备上打开简贴，填写相同的 Token 和仓库名即可自动拉取笔记。保存、删除、清空操作会自动推送到仓库，无需手动点击同步。

> 同步按钮用于手动从仓库拉取最新数据，适用于在其他设备上修改后需要刷新的场景。

## 绑定自定义域名（Cloudflare）

以托管在 Cloudflare 上的域名为例：

**Cloudflare 端：**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 选择你的域名 -> **DNS** -> **Records**
3. 添加记录：
   - **类型**: `CNAME`
   - **名称**: 你想要的子域名（如 `notes`），或 `@` 表示根域名
   - **目标**: `<用户名>.github.io`
   - **代理状态**: 关闭（灰色云朵，DNS only）
4. 点击 **Save**

**GitHub 端：**

1. 进入仓库 -> **Settings** -> **Pages**
2. 在 **Custom domain** 中填入你的域名（如 `notes.example.com`）
3. 点击 **Save**，等待 DNS 验证通过
4. 验证成功后勾选 **Enforce HTTPS**

> 如果使用根域名，Cloudflare 端的记录类型选 `A`，目标填入 GitHub Pages 的 IP 地址（可在 [GitHub 文档](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) 中查找）。

## License

[MIT](LICENSE)
