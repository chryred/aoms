package javax.servlet;

public interface Filter {
    void doFilter(ServletRequest req, ServletResponse resp, FilterChain chain);
}
