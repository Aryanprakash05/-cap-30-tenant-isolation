package com.capstone.exception;

/**
 * Thrown when Snowflake returns a 42501 (insufficient privileges) SQLState,
 * or when a client attempts an operation outside their permitted role/tenant.
 */
public class AccessDeniedException extends RuntimeException {

    private final String queryId;

    public AccessDeniedException(String message) {
        super(message);
        this.queryId = null;
    }

    public AccessDeniedException(String message, String queryId) {
        super(message);
        this.queryId = queryId;
    }

    public AccessDeniedException(String message, Throwable cause) {
        super(message, cause);
        this.queryId = null;
    }

    public String getQueryId() {
        return queryId;
    }
}
