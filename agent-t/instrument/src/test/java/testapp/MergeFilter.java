package testapp;

import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;

/** Branch merge of two sibling types plus a loop: the verifier needs the exact common superclass. */
public class MergeFilter implements Filter {
    public static String seen;

    public void doFilter(ServletRequest req, ServletResponse resp, FilterChain chain) {
        Branch b = req.getRemoteAddr() != null ? new BranchA() : new BranchB();
        int sum = 0;
        for (int i = 0; i < b.size(); i++) {
            sum += i;
        }
        seen = b.name() + sum;
        chain.doFilter(req, resp);
    }
}
