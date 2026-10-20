# komodo 바꿈 (ERDD)

## DB 비밀번호에만 기본값을 둔다

바꾸는 절: `komodo/01-environment.md` 「필수값은 `${VAR:?메시지}`, 선택값은 `${VAR:-기본값}` 으로 쓴다」

```yaml
API_URL: ${API_URL:?API_URL is required}   # 없으면 up 단계에서 바로 실패
LOG_LEVEL: ${LOG_LEVEL:-info}              # 없으면 info
```

비밀값·접속 주소에는 기본값을 두지 않는다. **예외는 `docker-compose.yml` 의 `POSTGRES_PASSWORD` 하나다** — `${POSTGRES_PASSWORD:-erdd}` 로 기본값 `erdd` 를 둔다. `db`·`migrate`·`app` 세 서비스가 같은 기본값을 쓴다.

- **Why:** 아무 표기 없는 `${VAR}` 는 값이 없으면 빈 문자열이 되어, 앱이 떠도 잘못 설정된 채 돈다. `:?` 는 배포를 compose 단계에서 멈춘다. DB 비밀번호만 예외인 것은 `.env` 없이 `docker compose up` 한 번으로 뜨는 빠른 시작을 설치 매뉴얼이 전제하기 때문이다. `db` 의 포트는 호스트 루프백(`127.0.0.1`)에만 붙고 앱은 compose 네트워크로 붙으므로, 기본값이 그대로 남아도 외부에서 닿는 길이 없다.
- **How to apply:**
  - 기본값이 있어도 안전한지(운영에서 틀리면 곤란한 값이 아닌지) 보고 `:-` 를 쓴다. 비밀값·접속 주소에는 기본값을 두지 않는다 — 위 예외 하나만 빼고.
  - ⚠️ **예외의 전제는 `db.ports` 가 루프백에만 붙는 것이다.** 그 줄을 `0.0.0.0` 이나 포트만으로 바꿔 외부에 열면 알려진 비밀번호로 DB 가 열린다 — 그때는 이 예외를 걷고 `${POSTGRES_PASSWORD:?…}` 로 바꾼다.
  - 운영 설치(Komodo 포함)에서는 `POSTGRES_PASSWORD` 를 Komodo Variable(Secret)로 넣는다(→ 「비밀값은 저장소에 두지 않고 Komodo Variables(Secret)에서 `[[KEY]]` 로 참조한다」). 값은 데이터 디렉터리를 **처음 초기화할 때만** 반영되므로 첫 기동 전에 넣는다.
