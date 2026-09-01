package games.betogo.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * 线路选择。可信来源不是 APK 里的域名白名单，而是服务端私钥签名 —— 白名单写死会让
 * 「临时注册一个域名、后台配上就能顶替被封线路」变成不可能（新域名必须重新出包）。
 * 内置域名退化为首次启动的探活种子，之后一切以验签通过的下发列表为准。
 */
final class AppDomainSelector {
    interface Callback { void onSelected(String origin, Set<String> knownDomains); }

    private static final String PREFS = "app_domain_selector";
    private static final String LAST_DOMAIN = "last_domain_";
    private static final String CACHED_DOMAINS = "cached_domains_";
    private static final String CACHED_VERSION = "cached_version_";
    private static final String CACHED_ISSUED_AT = "cached_issued_at_";
    private static final int TIMEOUT_MS = 1800;

    private final Context context;
    private final String market = BuildConfig.APP_MARKET;
    /** 只用于首次启动时有个地方可探；不再是「允许使用哪些域名」的判据 */
    private final List<String> seedDomains = new ArrayList<>();

    AppDomainSelector(Context context) {
        this.context = context.getApplicationContext();
        for (String domain : BuildConfig.APP_DOMAINS.split(",")) {
            String normalized = normalizeDomain(domain);
            if (!normalized.isEmpty() && !seedDomains.contains(normalized)) seedDomains.add(normalized);
        }
    }

    void select(Set<String> excluded, Callback callback) {
        List<Candidate> candidates = loadCandidates();
        candidates.removeIf(item -> excluded.contains(item.domain));
        if (candidates.isEmpty()) {
            new Handler(Looper.getMainLooper()).post(() -> callback.onSelected(null, new HashSet<>()));
            return;
        }
        ExecutorService executor = Executors.newFixedThreadPool(candidates.size());
        new Thread(() -> {
            List<Future<Result>> futures = new ArrayList<>();
            for (Candidate candidate : candidates) {
                futures.add(executor.submit((Callable<Result>) () -> probe(candidate)));
            }
            List<Result> alive = new ArrayList<>();
            for (Future<Result> future : futures) {
                try {
                    Result result = future.get();
                    if (result != null) alive.add(result);
                } catch (Exception ignored) {}
            }
            executor.shutdownNow();
            Result selected = choose(alive);
            if (selected != null) {
                preferences().edit()
                    .putString(LAST_DOMAIN + market, selected.domain)
                    .putString(CACHED_DOMAINS + market, selected.remoteDomains)
                    .putString(CACHED_VERSION + market, selected.configVersion)
                    .putLong(CACHED_ISSUED_AT + market, selected.issuedAt)
                    .apply();
            }
            String origin = selected == null ? null : selected.origin;
            Set<String> known = selected == null ? new HashSet<>() : domainsOf(selected.remoteDomains);
            new Handler(Looper.getMainLooper()).post(() -> callback.onSelected(origin, known));
        }).start();
    }

    private Result choose(List<Result> alive) {
        if (alive.isEmpty()) return null;
        // 粘住上次成功的域名，避免每次换线把 localStorage 里的会话和偏好甩掉。
        // 但后台调整过线路（configVersion 变了）时必须放弃粘性，否则运营新启用的更优线路永远轮不上。
        String cachedVersion = preferences().getString(CACHED_VERSION + market, "");
        boolean configChanged = false;
        for (Result result : alive) {
            if (!result.configVersion.isEmpty() && !result.configVersion.equals(cachedVersion)) {
                configChanged = true;
                break;
            }
        }
        if (!configChanged) {
            String last = preferences().getString(LAST_DOMAIN + market, "");
            for (Result result : alive) if (result.domain.equals(last)) return result;
        }
        return alive.stream().min(Comparator
            .comparingLong((Result item) -> item.elapsedMs)
            .thenComparingInt(item -> item.priority)).orElse(null);
    }

    private Result probe(Candidate candidate) {
        long startedAt = System.currentTimeMillis();
        HttpURLConnection connection = null;
        try {
            URL url = new URL("https://" + candidate.domain + "/api/v1/app/bootstrap?market=" + market + "&_=" + startedAt);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/json");
            if (connection.getResponseCode() != 200) return null;
            StringBuilder raw = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null && raw.length() < 65536) raw.append(line);
            }
            JSONObject body = new JSONObject(raw.toString());
            JSONObject data = body.optJSONObject("data");
            if (body.optInt("code", -1) != 0 || data == null || !market.equals(data.optString("market"))) return null;
            JSONArray domains = data.optJSONArray("domains");
            if (domains == null || domains.length() == 0) return null;
            long issuedAt = data.optLong("issuedAt", 0);
            // 拒绝重放：攻击者截下一份旧的合法响应，就能把用户按回已经弃用（甚至已被他拿下）的域名
            if (issuedAt < preferences().getLong(CACHED_ISSUED_AT + market, 0)) return null;

            JSONArray accepted = new JSONArray();
            StringBuilder signed = new StringBuilder("v1|").append(market).append('|');
            boolean currentEnabled = false;
            for (int i = 0; i < domains.length(); i++) {
                JSONObject item = domains.optJSONObject(i);
                if (item == null) return null;
                String rawDomain = item.optString("domain");
                int priority = item.optInt("priority", 100);
                if (i > 0) signed.append(',');
                signed.append(rawDomain).append(':').append(priority);
                String domain = normalizeDomain(rawDomain);
                if (domain.isEmpty()) return null;
                JSONObject safe = new JSONObject();
                safe.put("domain", domain);
                safe.put("priority", Math.max(1, priority));
                accepted.put(safe);
                if (domain.equals(candidate.domain)) currentEnabled = true;
            }
            signed.append('|').append(issuedAt);
            if (!verify(signed.toString(), data.optString("signature", ""))) return null;
            if (!currentEnabled) return null;

            // 跟随重定向后的落点必须仍在这份已验签的列表里：域名过期被抢注后 301 到站外时，
            // 不校验就等于把用户直接送进别人的站点。
            String finalHost = connection.getURL().getHost();
            if (!domainsOf(accepted.toString()).contains(normalizeDomain(finalHost))) return null;
            String origin = "https://" + finalHost;
            return new Result(candidate.domain, origin, candidate.priority,
                System.currentTimeMillis() - startedAt, accepted.toString(),
                data.optString("configVersion", ""), issuedAt);
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private List<Candidate> loadCandidates() {
        Map<String, Integer> result = new HashMap<>();
        String cached = preferences().getString(CACHED_DOMAINS + market, "");
        try {
            JSONArray rows = new JSONArray(cached);
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null) continue;
                String domain = normalizeDomain(row.optString("domain"));
                // 缓存只来自验签通过的响应，所以这里不再过白名单 —— 后台新配的域名正是靠这条路进来的
                if (!domain.isEmpty()) result.put(domain, Math.max(1, row.optInt("priority", 100)));
            }
        } catch (Exception ignored) {}
        int priority = 10;
        for (String domain : seedDomains) {
            result.putIfAbsent(domain, priority);
            priority += 10;
        }
        List<Candidate> candidates = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : result.entrySet()) {
            candidates.add(new Candidate(entry.getKey(), entry.getValue()));
        }
        candidates.sort(Comparator.comparingInt(item -> item.priority));
        return candidates;
    }

    /**
     * 公钥内置在 APK，私钥只在服务端。拿下任一线路域名、劫持 DNS、甚至签发了合法证书的攻击者
     * 都伪造不出签名，所以「接受服务端下发的任意域名」是安全的。
     * 公钥缺失时 release 一律拒绝（失败关闭）：白名单已经取消，再放行就等于接受任意
     * 服务器下发的任意域名，比改造前更不安全。只有 debug 构建允许空公钥。
     */
    private boolean verify(String payload, String signatureBase64) {
        String publicKeyBase64 = BuildConfig.APP_ROUTE_PUBLIC_KEY;
        if (publicKeyBase64.isEmpty()) return BuildConfig.DEBUG;
        if (signatureBase64.isEmpty()) return false;
        try {
            PublicKey key = KeyFactory.getInstance("EC").generatePublic(
                new X509EncodedKeySpec(Base64.decode(publicKeyBase64, Base64.DEFAULT)));
            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(key);
            verifier.update(payload.getBytes(StandardCharsets.UTF_8));
            return verifier.verify(Base64.decode(signatureBase64, Base64.DEFAULT));
        } catch (Exception ignored) {
            return false;
        }
    }

    private static Set<String> domainsOf(String cachedJson) {
        Set<String> result = new HashSet<>();
        try {
            JSONArray rows = new JSONArray(cachedJson);
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row != null) result.add(row.optString("domain"));
            }
        } catch (Exception ignored) {}
        return result;
    }

    private SharedPreferences preferences() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String normalizeDomain(String value) {
        if (value == null) return "";
        String raw = value.trim().toLowerCase();
        if (raw.isEmpty()) return "";
        try {
            String host = raw.contains("://") ? Uri.parse(raw).getHost() : Uri.parse("https://" + raw).getHost();
            if (host == null) return "";
            return host.replaceFirst("^www\\.", "");
        } catch (Exception ignored) {
            return "";
        }
    }

    private static final class Candidate {
        final String domain;
        final int priority;
        Candidate(String domain, int priority) { this.domain = domain; this.priority = priority; }
    }

    private static final class Result {
        final String domain;
        final String origin;
        final int priority;
        final long elapsedMs;
        final String remoteDomains;
        final String configVersion;
        final long issuedAt;
        Result(String domain, String origin, int priority, long elapsedMs, String remoteDomains,
               String configVersion, long issuedAt) {
            this.domain = domain;
            this.origin = origin;
            this.priority = priority;
            this.elapsedMs = elapsedMs;
            this.remoteDomains = remoteDomains;
            this.configVersion = configVersion;
            this.issuedAt = issuedAt;
        }
    }
}
