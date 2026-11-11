package com.capstone.service;

import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Minimal in-memory session service for the demo.
 * Tokens are UUIDs stored in a ConcurrentHashMap; JWT is out of scope.
 */
@Service
public class AuthService {

    // token → role
    private final ConcurrentHashMap<String, String> sessions = new ConcurrentHashMap<>();

    /**
     * username/password → Snowflake role mapping (demo credentials only).
     * In production these would come from a proper identity provider.
     */
    private static final Map<String, String[]> CREDENTIALS = Map.of(
            "steam_analyst",  new String[]{"SteamVault@2024",  "TENANT_A_ANALYST"},
            "ea_analyst",     new String[]{"EAVault@2024",     "TENANT_B_ANALYST"},
            "support_user",   new String[]{"SupportVault@2024", "CAPSTONE_SUPPORT"}
    );

    /**
     * Validates credentials and returns a session token mapped to the role.
     *
     * @throws IllegalArgumentException on bad credentials
     */
    public String login(String username, String password) {
        String[] entry = CREDENTIALS.get(username);
        if (entry == null || !entry[0].equals(password)) {
            throw new IllegalArgumentException("Invalid username or password");
        }
        String role  = entry[1];
        String token = UUID.randomUUID().toString();
        sessions.put(token, role);
        return token;
    }

    /**
     * Returns the role associated with the token, or {@code null} if the token
     * is unknown / expired.
     */
    public String getRoleForToken(String token) {
        if (token == null) return null;
        return sessions.get(token);
    }

    /** Returns the role associated with the given username (for login responses). */
    public String getRoleForUsername(String username) {
        String[] entry = CREDENTIALS.get(username);
        return entry != null ? entry[1] : null;
    }

    /** Removes the session, effectively logging the user out. */
    public void logout(String token) {
        if (token != null) {
            sessions.remove(token);
        }
    }
}
