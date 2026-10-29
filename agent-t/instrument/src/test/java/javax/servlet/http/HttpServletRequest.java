package javax.servlet.http;

import javax.servlet.ServletRequest;

public interface HttpServletRequest extends ServletRequest {
    String getMethod();

    String getRequestURI();

    String getHeader(String name);
}
