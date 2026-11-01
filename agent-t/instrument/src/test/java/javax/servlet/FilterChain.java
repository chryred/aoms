package javax.servlet;

public interface FilterChain {
    void doFilter(ServletRequest req, ServletResponse resp);
}
