# 完整备份与恢复

## 文件格式

完整备份的文件名为 `wealth-full-backup_<UTC timestamp>.wgtbackup.zip`，当前格式版本为 1。

ZIP 使用未压缩的 STORE 条目，包含：

- `manifest.json`
- `data/app-state.json`
- `monthly-planning/attachments/<sha256>.<ext>`
- 可选的 `client-meta/ai-connections.json`

Manifest 保存应用版本、构建身份、schema、文件数、原始大小和逐文件 SHA-256。完整备份不包含密钥、运行日志、缓存、安装包或机器绝对路径。

## 导出

导出前先排空待写队列。任何引用附件缺失或哈希不符都会使导出整体失败，不产生一个看似成功的半成品。

## 恢复

恢复目标必须是尚不存在的绝对路径。桌面端执行顺序：

1. 解析 ZIP、核对 manifest、条目 CRC 与 SHA-256。
2. 校验主状态 envelope、账本形状和理财 schema。
3. 写入目标同级暂存目录。
4. 逐文件读回大小和 SHA-256。
5. 暂存目录整体重命名到目标根。
6. 切换 `storage-config.json` 并回读新根。

任何步骤失败都保留原数据根和暂存文件，不覆盖现有数据。AI 凭据不在备份中；恢复后如果系统安全存储中没有对应授权，需要重新连接。

## 三种导出

| 名称 | 用途 |
|---|---|
| 完整备份 | 可在新空数据根独立恢复主数据与附件 |
| 结构备份 | 只含结构化状态，不含附件二进制 |
| 附件导出 | 只含附件与引用索引，不是可独立恢复的业务备份 |
