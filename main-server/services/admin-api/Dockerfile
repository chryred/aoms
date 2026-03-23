FROM python:3.11-slim

WORKDIR /app

# 오프라인 환경: pip-packages 디렉토리가 있으면 그쪽에서 설치
COPY requirements/ requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt

COPY . .

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
