# QQ avatar repair, v1.1.6-owner-avatar.2

There were two separate failures. First, the original plugin passed an AstrBot local file path into a different QQ gateway container, producing ENOENT. Second, a later retry message had no attached/quoted image. The plugin yielded a MessageEventResult, which native tool execution converts to None; the model received an ambiguous no-result response and later claimed success. The QQ public avatar was independently fetched and remained unchanged.

This patch sends inline image bytes and separates the direct command from the LLM tool. The tool returns an explicit string with missing-image, read-failure, gateway-failure or gateway-accepted status. Gateway acceptance is never described as verified QQ display. Commands return the same result to the user. Admin permissions remain in place. No old-image history lookup or fallback guessing is added.

10 focused tests passed. Native tool executor string propagation is checked on the cloud. QQ retry succeeded at 21:55:48 CST: gateway accepted the original 307,978 bytes, cache SHA256 matches, user confirmed success and a fresh public QQ avatar visually matches the uploaded portrait. Rollback backups: /opt/aipm-dafeiyu/backups/qqprofile-avatar-before-20261029 and /opt/aipm-dafeiyu/backups/qqprofile-avatar-before-v2-20261029.
