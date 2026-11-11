package com.capstone.filter;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.UUID;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter implements Filter {

    private static final Logger log = LoggerFactory.getLogger(RequestIdFilter.class);
    public static final String REQUEST_ID_HEADER = "X-Request-ID";

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        if (request instanceof HttpServletRequest httpRequest && response instanceof HttpServletResponse httpResponse) {
            String requestId = httpRequest.getHeader(REQUEST_ID_HEADER);
            if (requestId == null || requestId.isBlank()) {
                requestId = UUID.randomUUID().toString();
            }
            httpResponse.setHeader(REQUEST_ID_HEADER, requestId);
            long start = System.currentTimeMillis();
            try {
                chain.doFilter(request, response);
            } finally {
                long duration = System.currentTimeMillis() - start;
                log.info("HTTP {} {} -> status={} (took {}ms) [requestId={}]",
                        httpRequest.getMethod(),
                        httpRequest.getRequestURI(),
                        httpResponse.getStatus(),
                        duration,
                        requestId);
            }
        } else {
            chain.doFilter(request, response);
        }
    }
}
