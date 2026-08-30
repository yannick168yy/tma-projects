package games.betogo.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
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

final class AppDomainSelector {
    interface Callback { void onSelected(String origin); }

    private static final String PREFS = "app_domain_selector";
    private static final String LAST_DOMAIN = "last_domain_";
    private static final String CACHED_DOMAINS = "cached_domains_";
    private static final int TIMEOUT_MS = 1800;

    private final Context context;
    private final String market = BuildConfig.APP_MARKET;
    private final Set<String> allowedDomains = new HashSet<>();

    AppDomainSelector(Context context) {
        this.context = context.getApplicationContext();
        for (String domain : BuildConfig.APP_DOMAINS.split(",")) {
            String normalized = normalizeDomain(domain);
            if (!normalized.isEmpty()) allowedDomains.add(normalized);
        }
    }

    void select(Set<String> excluded, Callback callback) {
        List<Candidate> candidates = loadCandidates();
        candidates.removeIf(item -> excluded.contains(item.domain));
        if (candidates.isEmpty()) {
            new Handler(Looper.getMainLooper()).post(() -> callback.onSelected(null));
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
                    .apply();
            }
            String origin = selected == null ? null : selected.origin;
            new Handler(Looper.getMainLooper()).post(() -> callback.onSelected(origin));
        }).start();
    }

    private Result choose(List<Result> alive) {
        if (alive.isEmpty()) return null;
        String last = preferences().getString(LAST_DOMAIN + market, "");
        for (Result result : alive) if (result.domain.equals(last)) return result;
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
            if (domains == null) return null;
            JSONArray accepted = new JSONArray();
            boolean currentEnabled = false;
            for (int i = 0; i < domains.length(); i++) {
                JSONObject item = domains.optJSONObject(i);
                if (item == null) continue;
                String domain = normalizeDomain(item.optString("domain"));
                if (!allowedDomains.contains(domain)) continue;
                JSONObject safe = new JSONObject();
                safe.put("domain", domain);
                safe.put("priority", Math.max(1, item.optInt("priority", 100)));
                accepted.put(safe);
                if (domain.equals(candidate.domain)) currentEnabled = true;
            }
            if (!currentEnabled || accepted.length() == 0) return null;
            String finalHost = connection.getURL().getHost();
            String origin = "https://" + finalHost;
            return new Result(candidate.domain, origin, candidate.priority,
                System.currentTimeMillis() - startedAt, accepted.toString());
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
                if (allowedDomains.contains(domain)) result.put(domain, Math.max(1, row.optInt("priority", 100)));
            }
        } catch (Exception ignored) {}
        int priority = 10;
        for (String raw : BuildConfig.APP_DOMAINS.split(",")) {
            String domain = normalizeDomain(raw);
            if (!domain.isEmpty()) result.putIfAbsent(domain, priority);
            priority += 10;
        }
        List<Candidate> candidates = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : result.entrySet()) {
            candidates.add(new Candidate(entry.getKey(), entry.getValue()));
        }
        candidates.sort(Comparator.comparingInt(item -> item.priority));
        return candidates;
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
        Result(String domain, String origin, int priority, long elapsedMs, String remoteDomains) {
            this.domain = domain;
            this.origin = origin;
            this.priority = priority;
            this.elapsedMs = elapsedMs;
            this.remoteDomains = remoteDomains;
        }
    }
}
